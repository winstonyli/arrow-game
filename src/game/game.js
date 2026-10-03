import { World, KIND } from '../core/world.js';
import { Grid } from '../core/grid.js';
import { followCamera } from '../core/camera.js';
import { moveSystem, projectileSystem, collisionSystem } from '../core/systems.js';
import { createPlayer, movePlayer, autoFire } from './player.js';
import { enemyAISystem } from './enemies.js';
import { applySkill } from './skills.js';
import { gemSystem } from './gems.js';
import { orbitSystem } from './orbit.js';

export const BOUNDS = { w: 900, h: 600 };
export const VIEW = { w: 900, h: 600 };
export const CAPACITY = 50000;

export function createGame({ capacity = CAPACITY, bounds = BOUNDS, view, cellSize = 32, rng = Math.random, mode, input, fx, sfx }) {
  const game = {
    world: new World(capacity),
    grid: new Grid(bounds.w, bounds.h, cellSize, capacity),
    bounds,
    view: view ?? { w: Math.min(bounds.w, VIEW.w), h: Math.min(bounds.h, VIEW.h) },
    camera: { x: 0, y: 0 },
    rng,
    input,
    mode,
    fx,
    sfx,
    player: createPlayer(bounds.w / 2, bounds.h - 80),
    offer: null,
    over: false,
    kills: 0,
    xp: 0,
    level: 1,
    time: 0,
    skills: {}, // skill id -> times chosen (the UI's owned-skills strip)
    bossAt: -Infinity, // game time of the latest boss spawn (the UI's boss banner)
  };
  game.onKill =
    fx || sfx || mode.onKill
      ? (j) => {
          sfx?.kill(game.world.radius[j]);
          fx?.kill(game.world.x[j], game.world.y[j], game.world.radius[j], game.world.type[j]);
          mode.onKill?.(game, j);
        }
      : undefined;
  mode.start(game);
  followCamera(game.camera, game.player, game.bounds, game.view);
  return game;
}

export function tick(game, dt) {
  if (game.over || game.offer) return;
  const { world, grid, player, bounds } = game;
  movePlayer(player, game.input, dt, bounds);
  player.hp = Math.min(player.maxHp, player.hp + player.stats.regen * dt);
  enemyAISystem(world, player, dt, game.enemyFireOnScreen ? game.camera : null, game.view);
  moveSystem(world, dt);
  projectileSystem(world, dt, bounds, grid);
  grid.rebuild(world, KIND.ENEMY);
  autoFire(player, world, grid, dt);
  game.kills += collisionSystem(world, grid, player, game.onKill);
  game.kills += orbitSystem(world, grid, player, game.time + dt, dt, game.onKill) // the renderers draw at the post-tick time;
  game.xp += gemSystem(world, player, dt);
  if (player.hp <= 0) game.over = true;
  else game.mode.update(game, dt);
  game.time += dt;
  followCamera(game.camera, player, bounds, game.view);
}

export function choose(game, skillId) {
  if (!game.offer || !game.offer.includes(skillId)) return;
  applySkill(game.player.stats, skillId);
  game.skills[skillId] = (game.skills[skillId] ?? 0) + 1;
  game.offer = null;
  game.mode.onChosen(game);
}
