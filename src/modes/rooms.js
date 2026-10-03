import { KIND } from '../core/world.js';
import { ENEMY, spawnEnemy } from '../game/enemies.js';
import { pickChoices } from '../game/skills.js';

export function createRooms({ bossEvery = 10 } = {}) {
  return {
    room: 0,

    start(game) {
      this.room = 0;
      this.nextRoom(game);
    },

    nextRoom(game) {
      this.room++;
      const { world, bounds, player, rng } = game;
      world.clearKind(KIND.PROJECTILE);
      world.clearKind(KIND.ENEMY_PROJECTILE);
      player.x = bounds.w / 2;
      player.y = bounds.h - 80;
      const boss = this.room % bossEvery === 0;
      const n = 4 + this.room * 2;
      for (let i = 0; i < n; i++) {
        let type = ENEMY.CHASER;
        if (boss && i === 0) type = ENEMY.BOSS;
        else if (this.room >= 3 && rng() < 0.3) type = ENEMY.SHOOTER;
        spawnEnemy(world, type, 40 + rng() * (bounds.w - 80), 40 + rng() * bounds.h * 0.4);
      }
    },

    update(game) {
      if (!game.offer && game.world.kindCount[KIND.ENEMY] === 0) game.offer = pickChoices(game.rng, 3);
    },

    onChosen(game) {
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + 15);
      this.nextRoom(game);
    },

    hud() {
      return `Room ${this.room}`;
    },

    summary() {
      return `reached room ${this.room}`;
    },
  };
}
