import { KIND } from './world.js';
import { clamp } from './math.js';

export function moveSystem(world, dt) {
  for (let i = 0; i < world.high; i++) {
    if (world.kind[i] === KIND.NONE) continue;
    world.x[i] += world.vx[i] * dt;
    world.y[i] += world.vy[i] * dt;
  }
}

export function projectileSystem(world, dt, bounds) {
  for (let i = 0; i < world.high; i++) {
    const k = world.kind[i];
    if (k !== KIND.PROJECTILE && k !== KIND.ENEMY_PROJECTILE) continue;
    world.life[i] -= dt;
    if (world.life[i] <= 0) {
      world.despawn(i);
      continue;
    }
    const r = world.radius[i];
    let out = false;
    if (world.x[i] < r || world.x[i] > bounds.w - r) {
      if (world.bounce[i] > 0) {
        world.vx[i] = -world.vx[i];
        world.bounce[i]--;
        world.x[i] = clamp(world.x[i], r, bounds.w - r);
      } else {
        out = true;
      }
    }
    if (world.y[i] < r || world.y[i] > bounds.h - r) {
      if (world.bounce[i] > 0) {
        world.vy[i] = -world.vy[i];
        world.bounce[i]--;
        world.y[i] = clamp(world.y[i], r, bounds.h - r);
      } else {
        out = true;
      }
    }
    if (out) world.despawn(i);
  }
}

function hurt(player, dmg) {
  if (player.invuln > 0) return;
  player.hp -= dmg;
  player.invuln = 0.5;
}

// grid must be rebuilt for KIND.ENEMY this tick; grid.maxRadius sizes the candidate search. Returns the number of enemies killed.
export function collisionSystem(world, grid, player) {
  let kills = 0;
  for (let i = 0; i < world.high; i++) {
    const k = world.kind[i];
    if (k === KIND.PROJECTILE) {
      const n = grid.gather(world.x[i], world.y[i], world.radius[i] + grid.maxRadius);
      for (let q = 0; q < n; q++) {
        const j = grid.out[q];
        if (world.kind[j] !== KIND.ENEMY) continue;
        if (j === world.lastHit[i] && world.gen[j] === world.lastHitGen[i]) continue;
        const genJ = world.gen[j]; // before a lethal hit bumps it
        const dx = world.x[j] - world.x[i];
        const dy = world.y[j] - world.y[i];
        const rr = world.radius[i] + world.radius[j];
        if (dx * dx + dy * dy > rr * rr) continue;
        world.hp[j] -= world.damage[i];
        if (world.hp[j] <= 0) {
          world.despawn(j);
          kills++;
        }
        if (world.pierce[i] > 0) {
          world.pierce[i]--;
          world.lastHit[i] = j;
          world.lastHitGen[i] = genJ;
        } else {
          world.despawn(i);
          break;
        }
      }
    } else if (k === KIND.ENEMY_PROJECTILE) {
      const dx = player.x - world.x[i];
      const dy = player.y - world.y[i];
      const rr = player.radius + world.radius[i];
      if (dx * dx + dy * dy <= rr * rr) {
        hurt(player, world.damage[i]);
        world.despawn(i);
      }
    }
  }
  const n = grid.gather(player.x, player.y, player.radius + grid.maxRadius);
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const dx = world.x[j] - player.x;
    const dy = world.y[j] - player.y;
    const rr = player.radius + world.radius[j];
    if (dx * dx + dy * dy <= rr * rr) hurt(player, world.damage[j]);
  }
  return kills;
}
