import { World, KIND } from '../core/world.ts';
import { Grid } from '../core/grid.ts';
import { followCamera } from '../core/camera.ts';
import { moveSystem, projectileSystem, collisionSystem } from '../core/systems.ts';
import { createPlayer, movePlayer, autoFire } from './player.ts';
import { enemyAISystem } from './enemies.ts';
import { applySkill } from './skills.ts';
import { gemSystem } from './gems.ts';
import { orbitSystem } from './orbit.ts';
import type { Vec, Size } from '../core/math.ts';
import type { Player } from './player.ts';
import type { GhostState } from '../replay/ghost.ts';

// The run's rules: modes/arena, modes/rooms or modes/stress. Hooks run inside createGame, tick and choose.
export interface Mode {
  start(game: Game): void;
  update(game: Game, dt: number): void;
  onChosen(game: Game): void;
  onKill?(game: Game, enemyIndex: number): void;
  hud?(game: Game): string;
  summary?(game: Game): string;
  room?: number; // rooms (and stress, always 0): the current room; presentation and replays read it
  bossEvery?: number; // rooms only
}

// The mode names a run (and its records and replays) can have.
export type ModeName = 'arena' | 'rooms';

// Presentation hooks the sim calls (render/fx). It never reads anything back.
export interface GameFx {
  kill(x: number, y: number, r: number, pal: number): void;
  burst(x: number, y: number): void;
  shake(a: number): void;
  sample(game: Game): void;
}

// Sound hooks the sim calls (audio/sfx).
export interface GameSfx {
  kill(radius?: number): void;
  boss(): void;
}

export interface Game<M extends Mode = Mode, F extends GameFx = GameFx> {
  world: World;
  grid: Grid;
  bounds: Size;
  view: Size;
  camera: Vec;
  rng: () => number;
  input: Vec;
  mode: M;
  fx: F | undefined;
  sfx: GameSfx | undefined;
  player: Player;
  offer: string[] | null;
  over: boolean;
  kills: number;
  xp: number;
  level: number;
  time: number;
  ticks: number;
  skills: Record<string, number>;
  bossAt: number;
  onKill?: (enemyIndex: number) => void; // assigned right after construction (undefined when nothing listens)
  enemyFireOnScreen?: boolean; // set by the arena's start
  ghost?: GhostState | null; // set by main.js each frame for the renderers and HUD; the sim never reads it
}

export interface GameOptions<M extends Mode, F extends GameFx> {
  capacity?: number;
  bounds?: Size;
  view?: Size; // defaults to VIEW clipped to the bounds
  cellSize?: number;
  rng?: () => number;
  mode: M;
  input: Vec;
  fx?: F;
  sfx?: GameSfx;
}

export const BOUNDS = { w: 900, h: 600 };
export const VIEW = { w: 900, h: 600 };
export const CAPACITY = 50000;

export function createGame<M extends Mode, F extends GameFx = GameFx>({
  capacity = CAPACITY,
  bounds = BOUNDS,
  view,
  cellSize = 32,
  rng = Math.random,
  mode,
  input,
  fx,
  sfx,
}: GameOptions<M, F>): Game<M, F> {
  const game: Game<M, F> = {
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
    ticks: 0, // advancing ticks so far (replays refer to this)
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

export function tick(game: Game, dt: number): void {
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
  game.ticks++;
  followCamera(game.camera, player, bounds, game.view);
  game.fx?.sample(game);
}

export function choose(game: Game, skillId: string): void {
  if (!game.offer || !game.offer.includes(skillId)) return;
  applySkill(game.player.stats, skillId);
  game.skills[skillId] = (game.skills[skillId] ?? 0) + 1;
  game.offer = null;
  game.mode.onChosen(game);
}
