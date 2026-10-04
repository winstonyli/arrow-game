import { KIND } from '../core/world.ts';
import type { World } from '../core/world.ts';
import type { Grid } from '../core/grid.ts';
import { clamp } from '../core/math.ts';
import type { Vec, Size } from '../core/math.ts';
import { BLADE_DPS } from './orbit.ts';

export type PlayerStats = ReturnType<typeof baseStats>;
export type Player = ReturnType<typeof createPlayer>;

export function baseStats() {
  return {
    damage: 10,
    attackInterval: 0.5,
    projectileSpeed: 500,
    projectileCount: 1,
    spread: 0.2,
    pierce: 0,
    bounce: 0,
    moveSpeed: 220,
    range: 600,
    pickupRadius: 80,
    regen: 0, // hp per second
    homing: 0, // 1 = arrows steer toward the nearest enemy
    orbit: 0, // blades circling the player
    moveFireRate: 0, // fire-rate multiplier while moving; 0 = no shooting on the move (rooms), arena sets 0.5
    weapons: {} as Record<string, number>, // weapon id -> level (1..maxLevel); the bow is not listed and uses a slot
    damageMult: 1, // all weapons (Power Shot)
    cooldownMult: 1, // all weapons: multiplies every interval (Rapid Fire divides it)
    bladeDps: BLADE_DPS, // per blade, set by the Orbit Blade level
  };
}

export function createPlayer(x: number, y: number) {
  return { x, y, radius: 12, hp: 100, maxHp: 100, invuln: 0, cd: 0, moving: false, vx: 0, vy: 0, stats: baseStats() };
}

export function movePlayer(p: Player, input: Vec, dt: number, bounds: Size): void {
  const mag = Math.hypot(input.x, input.y);
  p.moving = mag > 0.01;
  p.invuln = Math.max(0, p.invuln - dt);
  p.vx = p.vy = 0; // the velocity actually travelled this tick (gems orbit in the player's frame)
  if (!p.moving) return;
  const k = (p.stats.moveSpeed * dt) / Math.max(mag, 1);
  const x = clamp(p.x + input.x * k, p.radius, bounds.w - p.radius);
  const y = clamp(p.y + input.y * k, p.radius, bounds.h - p.radius);
  p.vx = (x - p.x) / dt;
  p.vy = (y - p.y) / dt;
  p.x = x;
  p.y = y;
}

export function fireVolley(world: World, p: Player, angle: number): number {
  const s = p.stats;
  let n = 0;
  for (let k = 0; k < s.projectileCount; k++) {
    const a = angle + (k - (s.projectileCount - 1) / 2) * s.spread;
    const i = world.spawn(
      KIND.PROJECTILE,
      p.x,
      p.y,
      Math.cos(a) * s.projectileSpeed,
      Math.sin(a) * s.projectileSpeed,
      4,
      0,
    );
    if (i < 0) continue;
    world.damage[i] = s.damage * s.damageMult;
    world.life[i] = s.range / s.projectileSpeed;
    world.type[i] = s.homing; // projectile flag read by projectileSystem; the slot may hold a stale enemy type
    world.pierce[i] = s.pierce;
    world.bounce[i] = s.bounce;
    n++;
  }
  return n;
}

export function autoFire(p: Player, world: World, grid: Grid, dt: number): number {
  p.cd = Math.max(0, p.cd - dt);
  const rate = p.moving ? p.stats.moveFireRate : 1;
  if (rate <= 0 || p.cd > 0) return 0;
  const t = grid.nearest(world, p.x, p.y, p.stats.range);
  if (t < 0) return 0;
  p.cd = (p.stats.attackInterval * p.stats.cooldownMult) / rate;
  return fireVolley(world, p, Math.atan2(world.y[t] - p.y, world.x[t] - p.x));
}
