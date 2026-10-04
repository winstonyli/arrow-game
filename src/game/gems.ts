import { KIND } from '../core/world.ts';
import type { World } from '../core/world.ts';
import type { Player } from './player.ts';

export const GEM_RADIUS = 5;
export const GEM_LIFE = 60; // seconds before an uncollected gem despawns
// A captured gem is a damped orbit around the player, simulated in the player's frame of reference (so a
// moving player drags its gems along and a gem cannot be outrun): a spring-like pull of strength PULL^2 per px
// plus drag DRAG on the velocity relative to the player, and a sideways push that fades out over the first
// SWING_TIME so it swings around instead of dropping straight in. About 0.8 s from the edge of the pickup radius.
const PULL = 6.5; // rad/s: natural frequency of the pull (acceleration = PULL^2 * distance)
const DRAG = 5; // 1/s: how fast the relative velocity dies out
const SWING = 10;// 1/s: sideways acceleration, as a multiple of PULL * distance, that fades out over SWING_TIME
const SWING_TIME = 0.5; // s: the sideways push builds momentum without a jolt, then stops
const MAX_REL = 600; // px/s cap on the speed relative to the player, a safety net

export function spawnGem(world: World, x: number, y: number, value: number): number {
  const i = world.spawn(KIND.GEM, x, y, 0, 0, GEM_RADIUS, 0);
  if (i < 0) return -1;
  world.damage[i] = value;
  world.life[i] = GEM_LIFE;
  return i;
}

// Expires, attracts and collects gems. Returns the XP collected this tick. Scans world.high; gems are
// far fewer than enemies, so it needs no grid. A gem inside the pickup radius is captured (world.cd holds
// the seconds since capture, 0 = free) and stays captured. This only sets the gem's velocity; moveSystem
// moves it. Every gem is kicked the same way round, so a pile of them reads as a vortex. No RNG, no trig.
export function gemSystem(world: World, player: Player, dt: number): number {
  const reach = player.stats.pickupRadius;
  let xp = 0;
  for (let i = 0; i < world.high; i++) {
    if (world.kind[i] !== KIND.GEM) continue;
    world.life[i] -= dt;
    if (world.life[i] <= 0) {
      world.despawn(i);
      continue;
    }
    const rx = world.x[i] - player.x;
    const ry = world.y[i] - player.y;
    const d = Math.hypot(rx, ry);
    if (d <= player.radius + world.radius[i]) {
      xp += world.damage[i];
      world.despawn(i);
    } else if (world.cd[i] > 0 || d <= reach) {
      let ux = world.vx[i] - player.vx; // velocity relative to the player
      let uy = world.vy[i] - player.vy;
      const swing = SWING * PULL * d * Math.max(0, 1 - world.cd[i] / SWING_TIME); // sideways acceleration
      ux += ((-ry / d) * swing) * dt;
      uy += ((rx / d) * swing) * dt;
      world.cd[i] += dt;
      ux += (-PULL * PULL * rx - DRAG * ux) * dt;
      uy += (-PULL * PULL * ry - DRAG * uy) * dt;
      const u = Math.hypot(ux, uy);
      if (u > MAX_REL) {
        ux *= MAX_REL / u;
        uy *= MAX_REL / u;
      }
      world.vx[i] = ux + player.vx;
      world.vy[i] = uy + player.vy;
    }
  }
  return xp;
}
