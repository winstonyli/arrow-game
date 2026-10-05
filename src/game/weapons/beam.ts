import { KIND } from '../../core/world.ts';
import { hitEnemy, HIT_STATUS, HIT_TICK } from '../hit.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const BEAM_TICK = 0.25; // seconds between damage ticks
export const BEAM_MAX_DOTS = 40; // most dots the beam is drawn with (level 5: 320 / 8)
export const BEAM_DOT_GAP = 8; // px between drawn dots (presentation only)
export const BEAM_ALPHA = 0.7; // the line's opacity (presentation only)
export const BEAM_LEVELS = [
  { dps: 20, length: 160, turn: 1.2, halfWidth: 6 },
  { dps: 30, length: 190, turn: 1.6, halfWidth: 7 },
  { dps: 42, length: 230, turn: 2, halfWidth: 8 },
  { dps: 58, length: 270, turn: 2.5, halfWidth: 9 },
  { dps: 80, length: 320, turn: 3, halfWidth: 10 },
];

// The beam's whole state: its heading, whether it has pointed at a target yet (`started`), whether the last update had
// a target in range (`live`, read by the renderers) and the tick timer. All numbers, hashed as they are.
export interface BeamState { angle: number; started: number; live: number; cd: number }
export const createBeamState = (): BeamState => ({ angle: 0, started: 0, live: 0, cd: 0 });

// How many dots the beam is drawn with (shared by both renderers).
// The length at a level, clamped to the table (shared by both renderers).
export const beamLength = (level: number): number => BEAM_LEVELS[Math.min(BEAM_LEVELS.length, Math.max(1, level)) - 1].length;

export const beamDots = (length: number): number => Math.min(BEAM_MAX_DOTS, Math.floor(length / BEAM_DOT_GAP));

// Points the beam at the nearest enemy in range, turning at the level's capped rate along the shorter arc, and every
// BEAM_TICK damages each enemy on the segment through hitEnemy (HIT_STATUS | HIT_TICK: quiet, never a crit or a push).
// With no target nothing changes except live = 0 (the timer holds). Returns kills. grid must be rebuilt this tick.
export function updateBeam(game: Game, level: number, dt: number): number {
  const L = BEAM_LEVELS[level - 1];
  const b = game.wstate.beam;
  const { world, grid, player } = game;
  const t = grid.nearest(world, player.x, player.y, L.length);
  if (t < 0) {
    b.live = 0;
    return 0;
  }
  b.live = 1;
  const want = Math.atan2(world.y[t] - player.y, world.x[t] - player.x);
  if (!b.started) {
    b.started = 1;
    b.angle = want;
  } else {
    let d = want - b.angle;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2)); // the signed difference by the shorter arc
    const step = L.turn * dt;
    b.angle += Math.max(-step, Math.min(step, d));
    b.angle -= Math.PI * 2 * Math.round(b.angle / (Math.PI * 2)); // keep the heading in [-π, π]
  }
  b.cd -= dt;
  if (b.cd > 0) return 0;
  b.cd += BEAM_TICK;
  const ux = Math.cos(b.angle);
  const uy = Math.sin(b.angle);
  const dmg = L.dps * BEAM_TICK * player.stats.damageMult;
  const n = grid.gather(player.x + (ux * L.length) / 2, player.y + (uy * L.length) / 2, L.length / 2 + L.halfWidth + grid.maxRadius);
  let kills = 0;
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const ex = world.x[j] - player.x;
    const ey = world.y[j] - player.y;
    const p = Math.max(0, Math.min(L.length, ex * ux + ey * uy)); // projection on the segment, clamped
    const dx = ex - ux * p;
    const dy = ey - uy * p;
    const r = L.halfWidth + world.radius[j];
    if (dx * dx + dy * dy > r * r) continue;
    kills += hitEnemy(game, j, dmg, HIT_STATUS | HIT_TICK, 0, 0);
  }
  return kills;
}

export const BEAM: WeaponDef = {
  id: 'beam',
  name: 'Beam',
  desc: 'A beam slowly turns toward the nearest enemy and burns everything on its line',
  maxLevel: BEAM_LEVELS.length,
  update: updateBeam,
};
