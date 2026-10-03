import { KIND } from '../core/world.js';

export const GEM_RADIUS = 5;
export const GEM_LIFE = 60; // seconds before an uncollected gem despawns
const MAGNET_SPEED = 360; // px/s toward the player once inside the pickup radius

export function spawnGem(world, x, y, value) {
  const i = world.spawn(KIND.GEM, x, y, 0, 0, GEM_RADIUS, 0);
  if (i < 0) return -1;
  world.damage[i] = value;
  world.life[i] = GEM_LIFE;
  return i;
}

// Expires, attracts and collects gems. Returns the XP collected this tick. Scans world.high; gems are
// far fewer than enemies, so it needs no grid.
export function gemSystem(world, player, dt) {
  const reach = player.stats.pickupRadius;
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
    } else if (d <= reach) {
      const step = Math.min(MAGNET_SPEED * dt, d);
      world.x[i] += (dx / d) * step;
      world.y[i] += (dy / d) * step;
    }
  }
  return xp;
}
