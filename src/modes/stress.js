import { KIND } from '../core/world.ts';
import { ENEMY, spawnEnemy } from '../game/enemies.js';

// Steady-state load for benchmarks: holds `enemies` enemies and `projectiles` player projectiles
// alive by topping both up each tick. DUMMY enemies are static and spread evenly; CHASER enemies
// converge on the player, which is the worst case for the spatial grid.
export function createStress({ enemies, projectiles, enemyType = ENEMY.DUMMY }) {
  function topUp(game) {
    const { world, bounds, rng } = game;
    for (let n = enemies - world.kindCount[KIND.ENEMY]; n > 0; n--) {
      if (spawnEnemy(world, enemyType, rng() * bounds.w, rng() * bounds.h) < 0) break;
    }
    for (let n = projectiles - world.kindCount[KIND.PROJECTILE]; n > 0; n--) {
      const a = rng() * Math.PI * 2;
      const i = world.spawn(KIND.PROJECTILE, rng() * bounds.w, rng() * bounds.h, Math.cos(a) * 300, Math.sin(a) * 300, 4, 0);
      if (i < 0) break;
      world.damage[i] = 1;
      world.life[i] = 1e9;
      world.pierce[i] = 255;
      world.bounce[i] = 255;
    }
  }

  return {
    room: 0,
    start(game) {
      game.player.hp = game.player.maxHp = 1e9; // the player must outlive the run
      game.player.stats.attackInterval = 1e9; // projectiles come from topUp, not autoFire
      topUp(game);
    },
    update: topUp,
    onChosen() {},
  };
}
