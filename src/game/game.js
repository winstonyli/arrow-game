import { World, KIND } from '../core/world.js';
import { Grid } from '../core/grid.js';
import { moveSystem, projectileSystem, collisionSystem } from '../core/systems.js';
import { createPlayer, movePlayer, autoFire } from './player.js';
import { enemyAISystem, MAX_ENEMY_RADIUS } from './enemies.js';
import { applySkill } from './skills.js';

export const BOUNDS = { w: 900, h: 600 };

export function createGame({ capacity = 50000, bounds = BOUNDS, cellSize = 32, rng = Math.random, mode, input }) {
  const game = {
    world: new World(capacity),
    grid: new Grid(bounds.w, bounds.h, cellSize, capacity),
    bounds,
    rng,
    input,
    mode,
    player: createPlayer(bounds.w / 2, bounds.h - 80),
    offer: null,
    over: false,
    kills: 0,
    time: 0,
  };
  mode.start(game);
  return game;
}

export function tick(game, dt) {
  if (game.over || game.offer) return;
  const { world, grid, player, bounds } = game;
  movePlayer(player, game.input, dt, bounds);
  enemyAISystem(world, player, dt);
  moveSystem(world, dt);
  projectileSystem(world, dt, bounds);
  grid.rebuild(world, KIND.ENEMY);
  autoFire(player, world, grid, dt);
  game.kills += collisionSystem(world, grid, player, MAX_ENEMY_RADIUS);
  if (player.hp <= 0) game.over = true;
  else game.mode.update(game, dt);
  game.time += dt;
}

export function choose(game, skillId) {
  if (!game.offer || !game.offer.includes(skillId)) return;
  applySkill(game.player.stats, skillId);
  game.offer = null;
  game.mode.onChosen(game);
}
