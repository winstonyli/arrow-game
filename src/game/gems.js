import { KIND } from '../core/world.js';

export const GEM_RADIUS = 5;
export const GEM_LIFE = 60; // seconds before an uncollected gem despawns
const MAGNET_SPEED = 360; // px/s at full pull once a gem is captured
const MAGNET_OVER_MOVE = 1.5; // ...and never slower than this multiple of the player's speed
const START_PULL = 0.5; // fraction of full speed at the moment of capture: gems ease in
const RAMP = 0.18; // seconds to reach full speed
const OMEGA = 30; // rad/s the gem circles the player at full pull (about 5 turns/s, roughly one turn per pickup); eased in with the pull

export function spawnGem(world, x, y, value) {
  const i = world.spawn(KIND.GEM, x, y, 0, 0, GEM_RADIUS, 0);
  if (i < 0) return -1;
  world.damage[i] = value;
  world.life[i] = GEM_LIFE;
  return i;
}

// Expires, attracts and collects gems. Returns the XP collected this tick. Scans world.high; gems are
// far fewer than enemies, so it needs no grid. A gem inside the pickup radius is captured (world.cd holds
// the seconds since capture, 0 = free) and stays captured: it eases in, circles the player and spirals
// onto them. The gem is moved here directly (it keeps zero velocity). Each tick it steps toward the player
// and its offset is then rotated about the player by OMEGA*dt; the rotation uses the Cayley form
// (1-u^2)/(1+u^2), 2u/(1+u^2), u = angle/2, which preserves length exactly and needs no trig, so it is as
// deterministic as the rest of the sim. Every gem turns the same way, so a pile of them reads as a vortex.
export function gemSystem(world, player, dt) {
  const reach = player.stats.pickupRadius;
  const full = Math.max(MAGNET_SPEED, MAGNET_OVER_MOVE * player.stats.moveSpeed);
  let xp = 0;
  for (let i = 0; i < world.high; i++) {
    if (world.kind[i] !== KIND.GEM) continue;
    world.life[i] -= dt;
    if (world.life[i] <= 0) {
      world.despawn(i);
      continue;
    }
    const dx = player.x - world.x[i];
    const dy = player.y - world.y[i];
    const d = Math.hypot(dx, dy);
    if (d <= player.radius + world.radius[i]) {
      xp += world.damage[i];
      world.despawn(i);
    } else if (world.cd[i] > 0 || d <= reach) {
      world.cd[i] += dt;
      const ease = Math.min(1, START_PULL + ((1 - START_PULL) * world.cd[i]) / RAMP);
      const rest = (d - Math.min(full * ease * dt, d)) / d; // distance left, as a fraction of d
      const u = (OMEGA * ease * dt) / 2;
      const c = (1 - u * u) / (1 + u * u);
      const s = (2 * u) / (1 + u * u);
      const ox = -dx * rest;
      const oy = -dy * rest;
      world.x[i] = player.x + ox * c - oy * s;
      world.y[i] = player.y + ox * s + oy * c;
    }
  }
  return xp;
}
