import { KIND } from '../core/world.ts';

export const BLADE_ORBIT = 60; // px from the player's centre
export const BLADE_RADIUS = 8;
export const BLADE_SPEED = 3; // rad/s
export const MAX_BLADES = 8; // the renderers' buffers assume this cap
export const BLADE_DPS = 30; // per blade, to each enemy it overlaps

// Writes blade k's centre to `out`. Shared by the sim and the renderers so they cannot disagree.
export function bladePos(player, time, k, out) {
  const a = time * BLADE_SPEED + (k / player.stats.orbit) * Math.PI * 2;
  out.x = player.x + Math.cos(a) * BLADE_ORBIT;
  out.y = player.y + Math.sin(a) * BLADE_ORBIT;
}

const pos = { x: 0, y: 0 };

// Blades have no entity: each tick every overlapped enemy takes BLADE_DPS * dt. grid must be rebuilt
// for KIND.ENEMY this tick. onKill(enemyIndex) runs before a killed enemy is despawned. Returns kills.
export function orbitSystem(world, grid, player, time, dt, onKill) {
  let kills = 0;
  for (let k = 0; k < player.stats.orbit; k++) {
    bladePos(player, time, k, pos);
    const n = grid.gather(pos.x, pos.y, BLADE_RADIUS + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      const dx = world.x[j] - pos.x;
      const dy = world.y[j] - pos.y;
      const rr = BLADE_RADIUS + world.radius[j];
      if (dx * dx + dy * dy > rr * rr) continue;
      world.hp[j] -= BLADE_DPS * dt;
      if (world.hp[j] <= 0) {
        if (onKill) onKill(j);
        world.despawn(j);
        kills++;
      }
    }
  }
  return kills;
}
