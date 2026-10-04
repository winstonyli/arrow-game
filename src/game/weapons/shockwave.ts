import { KIND } from '../../core/world.ts';
import { damageEnemy } from './common.ts';
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

// The ring is fixed at the point it started from. `r` is its current radius, `max` the radius this pulse stops at, `cd` the
// time until the next pulse can start (counted from the start of a pulse). Presentation reads on/x/y/r/max.
export interface ShockState { cd: number; on: boolean; x: number; y: number; r: number; max: number }
export const createShockState = (): ShockState => ({ cd: 0, on: false, x: 0, y: 0, r: 0, max: 0 });

// Starts a pulse when the interval is up and an enemy is in reach, then grows the ring and hits every enemy whose
// distance from the ring's origin fell between last tick's radius and this tick's: each enemy is hit once, with no
// per-enemy memory. grid must be rebuilt for KIND.ENEMY this tick. Returns kills.
export function updateShockwave(game: Game, level: number, dt: number): number {
  const L = SHOCK_LEVELS[level - 1];
  const s = game.wstate.shock;
  const { world, grid, player } = game;
  s.cd = Math.max(0, s.cd - dt);
  if (!s.on) {
    if (s.cd > 0) return 0;
    if (grid.nearest(world, player.x, player.y, L.radius) < 0) return 0; // wait for a target; no cooldown spent
    s.on = true;
    s.x = player.x;
    s.y = player.y;
    s.r = 0;
    s.max = L.radius;
    s.cd = L.interval * player.stats.cooldownMult;
  }
  const prev = s.r;
  s.r = Math.min(s.max, prev + SHOCK_SPEED * dt);
  const dmg = L.damage * player.stats.damageMult;
  let kills = 0;
  const n = grid.gather(s.x, s.y, s.r + grid.maxRadius);
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const d = Math.hypot(world.x[j] - s.x, world.y[j] - s.y);
    if (d <= prev || d > s.r) continue;
    kills += damageEnemy(world, j, dmg, game.onKill);
  }
  if (s.r >= s.max) s.on = false;
  return kills;
}

export const SHOCKWAVE: WeaponDef = {
  id: 'shockwave',
  name: 'Shockwave',
  desc: 'A ring pulses out from you and hits everything it crosses',
  maxLevel: SHOCK_LEVELS.length,
  update: updateShockwave,
};
