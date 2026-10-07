import { KIND } from '../../core/world.ts';
import { hitEnemy } from '../hit.ts';
import { HIT_FLAGS } from '../coverage.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const METEOR_CAP = 12; // pending strikes; 3 per volley at most and 0.6 s of telegraph keep the live count well under this
export const METEOR_RANGE = 320; // px from the player within which an enemy can be targeted (centre distance)
export const METEOR_TELEGRAPH = 0.6; // seconds from marking to impact
export const METEOR_RING_MIN = 0.25; // ring opacity when marked (presentation only)
export const METEOR_RING_MAX = 0.9; // ring opacity at impact (presentation only)
const METEOR_PAL = -1; // render/fx PAL_GEM (gold), the same value as BLAST_PAL in hit.ts; the sim does not import render code
export const METEOR_LEVELS = [
  { count: 1, dmg: 50, radius: 40, interval: 4 },
  { count: 1, dmg: 70, radius: 44, interval: 3.6 },
  { count: 2, dmg: 95, radius: 48, interval: 3.2 },
  { count: 2, dmg: 125, radius: 52, interval: 2.8 },
  { count: 3, dmg: 160, radius: 56, interval: 2.4 },
];
export const meteorRadius = (level: number): number => METEOR_LEVELS[Math.min(METEOR_LEVELS.length, Math.max(1, level)) - 1].radius;

// A fixed pool of pending strikes (parallel arrays; a slot is live while on[k] is 1) and the fire timer `cd`.
// Presentation reads x/y/age/on and never writes them.
export interface MeteorState { cd: number; x: Float32Array; y: Float32Array; age: Float32Array; on: Uint8Array }
export const createMeteorState = (): MeteorState => ({
  cd: 0,
  x: new Float32Array(METEOR_CAP),
  y: new Float32Array(METEOR_CAP),
  age: new Float32Array(METEOR_CAP),
  on: new Uint8Array(METEOR_CAP),
});

// A pending strike's ring opacity: it brightens linearly from METEOR_RING_MIN to METEOR_RING_MAX over the telegraph.
export function meteorAlpha(age: number): number {
  return METEOR_RING_MIN + (METEOR_RING_MAX - METEOR_RING_MIN) * Math.min(1, age / METEOR_TELEGRAPH);
}

// Resolves each strike that reached the telegraph time (the strike is cleared first, then every enemy in the blast takes
// the level's damage through hitEnemy, flags from the coverage table), then fires a volley when the timer allows:
// up to the level's count of distinct random enemies within METEOR_RANGE of the player, each stored at its current
// position. Returns kills. grid must be rebuilt for KIND.ENEMY this tick.
export function updateMeteors(game: Game, level: number, dt: number): number {
  const L = METEOR_LEVELS[level - 1];
  const m = game.wstate.meteors;
  const { world, grid, player } = game;
  const dmg = L.dmg * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < METEOR_CAP; k++) {
    if (!m.on[k]) continue;
    m.age[k] += dt;
    if (m.age[k] < METEOR_TELEGRAPH) continue;
    m.on[k] = 0;
    const mx = m.x[k];
    const my = m.y[k];
    game.fx?.kill(mx, my, L.radius, METEOR_PAL);
    const n = grid.gather(mx, my, L.radius + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      const ex = world.x[j] - mx;
      const ey = world.y[j] - my;
      const r = L.radius + world.radius[j];
      if (ex * ex + ey * ey > r * r) continue;
      kills += hitEnemy(game, j, dmg, HIT_FLAGS.meteor, ex, ey);
    }
  }
  m.cd -= dt;
  if (m.cd > 0) return kills;
  // Candidates: compact the in-range enemies into the front of grid.out (valid until the next gather; nothing gathers below).
  const n = grid.gather(player.x, player.y, METEOR_RANGE + grid.maxRadius);
  let c = 0;
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const ex = world.x[j] - player.x;
    const ey = world.y[j] - player.y;
    if (ex * ex + ey * ey <= METEOR_RANGE * METEOR_RANGE) grid.out[c++] = j;
  }
  if (c === 0) return kills;
  for (let p = 0; p < L.count && c > 0; p++) {
    const i = Math.floor(game.rng() * c);
    const j = grid.out[i];
    grid.out[i] = grid.out[--c];
    const f = m.on.indexOf(0);
    if (f < 0) continue;
    m.x[f] = world.x[j];
    m.y[f] = world.y[j];
    m.age[f] = 0;
    m.on[f] = 1;
  }
  m.cd = L.interval * player.stats.cooldownMult;
  return kills;
}

export const METEOR: WeaponDef = {
  id: 'meteor',
  name: 'Incoming!',
  desc: 'Targets get a warning ring, then a flaming rock hits the spot',
  maxLevel: METEOR_LEVELS.length,
  update: updateMeteors,
};
