import { KIND } from '../../core/world.ts';
import { hitEnemy } from '../hit.ts';
import { HIT_FLAGS } from '../coverage.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const CHAIN_RANGE = 300; // px from the player to the first target
export const CHAIN_JUMP = 150; // px from one target to the next
export const CHAIN_FALLOFF = 0.8; // damage multiplier per jump
export const CHAIN_LIFE = 0.15; // seconds a zap stays drawn
export const CHAIN_LEVELS = [
  { jumps: 2, damage: 15, interval: 1.6 },
  { jumps: 3, damage: 20, interval: 1.4 },
  { jumps: 4, damage: 26, interval: 1.25 },
  { jumps: 5, damage: 33, interval: 1.1 },
  { jumps: 6, damage: 42, interval: 1.0 },
];
export const DAISY_JUMPS = 3; // Daisy Chain: extra jumps
export const DAISY_FALLOFF = 0.9; // and the per-jump damage multiplier (instead of CHAIN_FALLOFF)
export const DAISY_DMG = 0.85; // and its damage multiplier
export const CORONA_RADIUS = 220; // Corona Wire: the aura's reach in px
// Corona Wire per level (3..5, the levels a branch can have): enemies zapped per pulse, damage each, pulse interval.
export const CORONA_LEVELS = [
  { n: 3, damage: 18, interval: 1.25 },
  { n: 4, damage: 23, interval: 1.1 },
  { n: 5, damage: 29, interval: 1.0 },
];
export const MAX_JUMPS = CHAIN_LEVELS[CHAIN_LEVELS.length - 1].jumps + DAISY_JUMPS;
const CORONA_MAX_N = CORONA_LEVELS[CORONA_LEVELS.length - 1].n;
const PATH_MAX = Math.max(MAX_JUMPS + 2, 2 * CORONA_MAX_N + 1);

// The last zap's path for drawing: the player's position, then each enemy hit, `n` points in px/py. `life` counts down
// to zero; the sim only writes it, the renderers read it.
export interface ChainState { cd: number; life: number; n: number; px: Float32Array; py: Float32Array }
export const createChainState = (): ChainState => ({ cd: 0, life: 0, n: 0, px: new Float32Array(PATH_MAX), py: new Float32Array(PATH_MAX) });

const hit = new Uint32Array(Math.max(MAX_JUMPS + 1, CORONA_MAX_N)); // slots hit by the current zap

// Ticks the cooldown, then fires by branch (stats.branches.chain): 0 the plain chain, 1 Corona Wire, 2 Daisy Chain.
// Waits (spending nothing) when nothing is in reach. grid must be rebuilt for KIND.ENEMY this tick. Returns kills.
export function updateChain(game: Game, level: number, dt: number): number {
  const s = game.wstate.chain;
  s.cd = Math.max(0, s.cd - dt);
  s.life = Math.max(0, s.life - dt);
  if (s.cd > 0) return 0;
  const branch = game.player.stats.branches.chain ?? 0;
  return branch === 1 ? zapCorona(game, level) : zapChain(game, level, branch === 2);
}

// Zaps the nearest enemy in range, then jumps to the nearest enemy not yet hit, up to `jumps` times, each hit weaker.
// Daisy Chain: DAISY_JUMPS more jumps, DAISY_FALLOFF per jump, DAISY_DMG of the damage.
function zapChain(game: Game, level: number, daisy: boolean): number {
  const L = CHAIN_LEVELS[level - 1];
  const s = game.wstate.chain;
  const { world, grid, player } = game;
  const jumps = L.jumps + (daisy ? DAISY_JUMPS : 0);
  const fall = daisy ? DAISY_FALLOFF : CHAIN_FALLOFF;
  let cur = grid.nearest(world, player.x, player.y, CHAIN_RANGE);
  if (cur < 0) return 0;
  s.cd = L.interval * player.stats.cooldownMult;
  s.life = CHAIN_LIFE;
  s.px[0] = player.x;
  s.py[0] = player.y;
  s.n = 1;
  let dmg = L.damage * player.stats.damageMult * (daisy ? DAISY_DMG : 1);
  let kills = 0;
  for (let k = 0; k <= jumps; k++) {
    const cx = world.x[cur];
    const cy = world.y[cur];
    hit[k] = cur;
    const hx = cx - s.px[s.n - 1];
    const hy = cy - s.py[s.n - 1];
    s.px[s.n] = cx;
    s.py[s.n] = cy;
    s.n++;
    kills += hitEnemy(game, cur, dmg, HIT_FLAGS.chain, hx, hy);
    dmg *= fall;
    if (k === jumps) break;
    let best = -1;
    let bestD = CHAIN_JUMP * CHAIN_JUMP;
    const n = grid.gather(cx, cy, CHAIN_JUMP);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      let seen = false;
      for (let h = 0; h <= k; h++) if (hit[h] === j) seen = true;
      if (seen) continue;
      const d = (world.x[j] - cx) ** 2 + (world.y[j] - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) break;
    cur = best;
  }
  return kills;
}

// Corona Wire: an aura pulse. Zaps up to C.n enemies nearest the player inside CORONA_RADIUS at once (no jumps); still a
// 'chain' hit. The drawn path is player, e1, player, e2, ... so the existing polyline draws a star. Waits when nothing is in reach.
function zapCorona(game: Game, level: number): number {
  const C = CORONA_LEVELS[level - 3];
  const s = game.wstate.chain;
  const { world, grid, player } = game;
  const n = grid.gather(player.x, player.y, CORONA_RADIUS + grid.maxRadius);
  const r2 = CORONA_RADIUS * CORONA_RADIUS;
  let picked = 0;
  for (; picked < C.n; picked++) {
    let best = -1;
    let bestD = r2;
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      let seen = false;
      for (let h = 0; h < picked; h++) if (hit[h] === j) seen = true;
      if (seen) continue;
      const d = (world.x[j] - player.x) ** 2 + (world.y[j] - player.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) break;
    hit[picked] = best;
  }
  if (picked === 0) return 0;
  s.cd = C.interval * player.stats.cooldownMult;
  s.life = CHAIN_LIFE;
  s.n = 0;
  for (let k = 0; k < picked; k++) { // before any hit: a kill frees its slot
    s.px[s.n] = player.x;
    s.py[s.n++] = player.y;
    s.px[s.n] = world.x[hit[k]];
    s.py[s.n++] = world.y[hit[k]];
  }
  const dmg = C.damage * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < picked; k++) kills += hitEnemy(game, hit[k], dmg, HIT_FLAGS.chain, s.px[2 * k + 1] - player.x, s.py[2 * k + 1] - player.y);
  return kills;
}

export const CHAIN: WeaponDef = {
  id: 'chain',
  name: 'Live Wire',
  desc: 'A bolt snaps to the nearest enemy and whips on to its neighbours',
  maxLevel: CHAIN_LEVELS.length,
  update: updateChain,
  branches: [
    { name: 'Corona Wire', desc: 'A pulse around you zaps several close enemies at once, no jumping' },
    { name: 'Daisy Chain', desc: 'The bolt jumps 3 more times and fades less, but hits 15% softer' },
  ],
};
