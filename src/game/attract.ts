import { createGame, tick, choose } from './game.ts';
import { createArena, ARENA_BOUNDS } from '../modes/arena.ts';
import { seeded } from '../core/math.ts';
import { KIND } from '../core/world.ts';
import type { Game, GameFx } from './game.ts';
import type { Vec } from '../core/math.ts';

export const ATTRACT_CAPACITY = 5000;
export const ATTRACT_SPEED = 0.5; // the backdrop runs at this fraction of real time: calmer behind the menu
export const ATTRACT_CAMERA_RATE = 2.5; // draw-camera ease rate (per second) while it is shown; play uses the default 12
export const ATTRACT_RESTART = 90; // seconds of game time before the title screen starts a fresh run, so it stays lively and cheap

const FLEE = 260; // px: enemies closer than this push the bot away (1/d weighting)
const WALL = 250; // px: the walls push it back from this far

// The title-screen backdrop: a real arena run, invulnerable and steered by a small bot (flee, avoid walls, else drift to the nearest gem), picking the first card at every level-up; the first `warmup` game-seconds are played before it is shown. Never recorded or heard; main.ts only ticks and draws it while the title is up.
export function createAttract<F extends GameFx>(fx: F, seed = Math.floor(Math.random() * 2 ** 31), warmup = 30) {
  const input: Vec = { x: 0, y: 0 };
  const game = createGame({ capacity: ATTRACT_CAPACITY, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(seed), input, fx });
  game.player.hp = game.player.maxHp = 1e9;
  const step = (dt: number): void => {
    if (game.offer) choose(game, game.offer[0]);
    steer(game);
    tick(game, dt * ATTRACT_SPEED);
  };
  for (let t = 0; t < warmup / ATTRACT_SPEED; t += 1 / 60) step(1 / 60); // start with enemies already on the field
  return { game, step };
}

function steer(g: Game): void {
  const { world, player, bounds, input } = g;
  let fx = 0, fy = 0, gx = 0, gy = 0, gd = Infinity;
  for (let i = 0; i < world.high; i++) {
    const k = world.kind[i];
    if (k === KIND.NONE || k === KIND.PROJECTILE) continue;
    const dx = player.x - world.x[i], dy = player.y - world.y[i];
    const d = Math.hypot(dx, dy) || 1;
    if (k === KIND.GEM) { if (d < gd) { gd = d; gx = -dx / d; gy = -dy / d; } continue; }
    if (d > FLEE) continue;
    const w = (FLEE - d) / FLEE / d;
    fx += dx * w; fy += dy * w;
  }
  fx += Math.max(0, WALL - player.x) / WALL - Math.max(0, WALL - (bounds.w - player.x)) / WALL;
  fy += Math.max(0, WALL - player.y) / WALL - Math.max(0, WALL - (bounds.h - player.y)) / WALL;
  fx += (bounds.w / 2 - player.x) / bounds.w; // a gentle pull to the middle keeps the show away from the walls
  fy += (bounds.h / 2 - player.y) / bounds.h;
  const m = Math.hypot(fx, fy);
  if (m > 0.02) { input.x = fx / m; input.y = fy / m; }
  else if (gd < Infinity) { input.x = gx; input.y = gy; }
  else { input.x = 0; input.y = 0; }
}
