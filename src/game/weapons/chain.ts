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
export const MAX_JUMPS = CHAIN_LEVELS[CHAIN_LEVELS.length - 1].jumps;

// The last zap's path for drawing: the player's position, then each enemy hit, `n` points in px/py. `life` counts down
// to zero; the sim only writes it, the renderers read it.
export interface ChainState { cd: number; life: number; n: number; px: Float32Array; py: Float32Array }
export const createChainState = (): ChainState => ({ cd: 0, life: 0, n: 0, px: new Float32Array(MAX_JUMPS + 2), py: new Float32Array(MAX_JUMPS + 2) });

const hit = new Uint32Array(MAX_JUMPS + 1); // slots hit by the current zap

// Zaps the nearest enemy in range when the interval is up, then jumps to the nearest enemy not yet hit, up to
// `jumps` times, each hit weaker. Waits (spending nothing) when nothing is in range. grid must be rebuilt for
// KIND.ENEMY this tick. Returns kills.
export function updateChain(game: Game, level: number, dt: number): number {
  const L = CHAIN_LEVELS[level - 1];
  const s = game.wstate.chain;
  const { world, grid, player } = game;
  s.cd = Math.max(0, s.cd - dt);
  s.life = Math.max(0, s.life - dt);
  if (s.cd > 0) return 0;
  let cur = grid.nearest(world, player.x, player.y, CHAIN_RANGE);
  if (cur < 0) return 0;
  s.cd = L.interval * player.stats.cooldownMult;
  s.life = CHAIN_LIFE;
  s.px[0] = player.x;
  s.py[0] = player.y;
  s.n = 1;
  let dmg = L.damage * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k <= L.jumps; k++) {
    const cx = world.x[cur];
    const cy = world.y[cur];
    hit[k] = cur;
    const hx = cx - s.px[s.n - 1];
    const hy = cy - s.py[s.n - 1];
    s.px[s.n] = cx;
    s.py[s.n] = cy;
    s.n++;
    kills += hitEnemy(game, cur, dmg, HIT_FLAGS.chain, hx, hy);
    dmg *= CHAIN_FALLOFF;
    if (k === L.jumps) break;
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

export const CHAIN: WeaponDef = {
  id: 'chain',
  name: 'Live Wire',
  desc: 'A bolt snaps to the nearest enemy and whips on to its neighbours',
  maxLevel: CHAIN_LEVELS.length,
  update: updateChain,
};
