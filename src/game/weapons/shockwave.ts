import { KIND } from '../../core/world.ts';
import { hitEnemy } from '../hit.ts';
import { HIT_FLAGS } from '../coverage.ts';
import { HIT_SHOVE } from '../hitflags.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const SHOCK_SPEED = 400; // px/s the ring expands
export const SHOCK_LEVELS = [
  { damage: 20, radius: 150, interval: 5 },
  { damage: 30, radius: 190, interval: 4.5 },
  { damage: 40, radius: 230, interval: 4 },
  { damage: 55, radius: 270, interval: 3.5 },
  { damage: 75, radius: 320, interval: 3 },
];
export const AFTER_DELAY = 0.4; // Aftershock: seconds between the rings
export const AFTER_DMG = 0.8; // Aftershock: damage multiplier for both rings
export const AFTER_ECHO = 0.6; // Aftershock: the second ring's share of the first's damage
export const FISSURE_RANGE = 2.4; // Fissure: reach multiplier
export const FISSURE_DMG = 1.8; // Fissure: damage multiplier
export const FISSURE_HALF = 30; // Fissure: half the crack's width in px (a 60 px crack)

// Ring 1 is fixed at the point it started from: `r` its radius, `max` where it stops, `cd` the time until the next pulse
// can start (counted from the start of a pulse). Fissure uses the same r/max as the crack's length along (ux, uy) (`line`
// is true for it, for the renderers). Aftershock's second ring has its own origin (x2, y2) and radius r2; d2 counts down
// to it (0 = none pending). seen / seen2 hold the enemies each ring or crack has already hit this pulse; they are a pure
// function of the run, so they are not hashed.
export interface ShockState {
  cd: number; on: boolean; x: number; y: number; r: number; max: number;
  ux: number; uy: number; line: boolean;
  d2: number; on2: boolean; x2: number; y2: number; r2: number;
  seen: Set<number>; seen2: Set<number>;
}
export const createShockState = (): ShockState => ({ cd: 0, on: false, x: 0, y: 0, r: 0, max: 0, ux: 0, uy: 0, line: false, d2: 0, on2: false, x2: 0, y2: 0, r2: 0, seen: new Set(), seen2: new Set() });

// Hits every enemy whose distance from (x, y) fell between prev and r, pushing along the line from the origin. An enemy in
// `seen` is skipped, so a push that carries it ahead of the ring cannot make the ring hit it again.
function sweepRing(game: Game, x: number, y: number, prev: number, r: number, dmg: number, shove: number, seen: Set<number>): number {
  const { world, grid } = game;
  let kills = 0;
  const n = grid.gather(x, y, r + grid.maxRadius);
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const dx = world.x[j] - x;
    const dy = world.y[j] - y;
    const d = Math.hypot(dx, dy);
    if (d <= prev || d > r) continue;
    const key = j + world.gen[j] * world.capacity;
    if (seen.has(key)) continue;
    seen.add(key);
    kills += hitEnemy(game, j, dmg, HIT_FLAGS.shockwave | shove, dx, dy);
  }
  return kills;
}

// Fissure: hits every enemy whose projection on the crack's line fell between prev and r and that sits within the crack's
// half-width (plus its own radius), once each (see sweepRing).
function sweepLine(game: Game, s: ShockState, prev: number, dmg: number): number {
  const { world, grid } = game;
  let kills = 0;
  const mid = (prev + s.r) / 2;
  const n = grid.gather(s.x + s.ux * mid, s.y + s.uy * mid, (s.r - prev) / 2 + FISSURE_HALF + grid.maxRadius);
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const dx = world.x[j] - s.x;
    const dy = world.y[j] - s.y;
    const t = dx * s.ux + dy * s.uy;
    if (t <= prev || t > s.r) continue;
    if (Math.abs(dx * s.uy - dy * s.ux) > FISSURE_HALF + world.radius[j]) continue;
    const key = j + world.gen[j] * world.capacity;
    if (s.seen.has(key)) continue;
    s.seen.add(key);
    kills += hitEnemy(game, j, dmg, HIT_FLAGS.shockwave, s.ux, s.uy);
  }
  return kills;
}

// Starts a pulse when the interval is up and an enemy is in reach, then grows the ring (or crack) and hits every enemy
// whose distance fell between last tick's radius and this tick's, once each per ring (enforced by the seen sets).
// grid must be rebuilt for KIND.ENEMY this tick. Returns kills.
export function updateShockwave(game: Game, level: number, dt: number): number {
  const L = SHOCK_LEVELS[level - 1];
  const s = game.wstate.shock;
  const { world, grid, player } = game;
  const branch = player.stats.branches.shockwave ?? 0; // 1 Aftershock, 2 Fissure
  const reach = branch === 2 ? L.radius * FISSURE_RANGE : L.radius;
  s.cd = Math.max(0, s.cd - dt);
  if (!s.on && s.cd <= 0) {
    const t = grid.nearest(world, player.x, player.y, reach);
    if (t >= 0) { // else wait for a target; no cooldown spent
      s.on = true;
      s.x = player.x;
      s.y = player.y;
      s.r = 0;
      s.max = reach;
      s.cd = L.interval * player.stats.cooldownMult;
      s.line = branch === 2;
      s.seen.clear();
      if (s.line) {
        const dx = world.x[t] - s.x;
        const dy = world.y[t] - s.y;
        const m = Math.hypot(dx, dy) || 1;
        s.ux = dx / m;
        s.uy = dy / m;
      }
      if (branch === 1) s.d2 = AFTER_DELAY;
    }
  }
  const dmg = L.damage * player.stats.damageMult * (branch === 1 ? AFTER_DMG : branch === 2 ? FISSURE_DMG : 1);
  const shove = branch === 1 ? HIT_SHOVE : 0; // Aftershock's rings shove even without Personal Space
  let kills = 0;
  if (s.on) {
    const prev = s.r;
    s.r = Math.min(s.max, prev + SHOCK_SPEED * dt);
    kills += s.line ? sweepLine(game, s, prev, dmg) : sweepRing(game, s.x, s.y, prev, s.r, dmg, shove, s.seen);
    if (s.r >= s.max) s.on = false;
  }
  if (s.d2 > 0) {
    s.d2 -= dt;
    if (s.d2 <= 0) {
      s.d2 = 0;
      s.on2 = true;
      s.x2 = s.x;
      s.y2 = s.y;
      s.r2 = 0;
      s.seen2.clear();
    }
  }
  if (s.on2) {
    const prev = s.r2;
    s.r2 = Math.min(s.max, prev + SHOCK_SPEED * dt);
    kills += sweepRing(game, s.x2, s.y2, prev, s.r2, dmg * AFTER_ECHO, shove, s.seen2);
    if (s.r2 >= s.max) s.on2 = false;
  }
  return kills;
}

export const SHOCKWAVE: WeaponDef = {
  id: 'shockwave',
  name: 'Quake',
  desc: 'The ground ripples outward from your feet, hitting everything it reaches',
  maxLevel: SHOCK_LEVELS.length,
  update: updateShockwave,
  branches: [
    { name: 'Aftershock', desc: 'A second ring follows and both shove enemies back, at a bit less damage' },
    { name: 'Fissure', desc: 'The ripple becomes a narrow crack that races far toward the nearest enemy and hits harder' },
  ],
};
