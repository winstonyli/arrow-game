import { KIND } from '../core/world.js';
import { ENEMY, ENEMY_TYPES, spawnEnemy } from '../game/enemies.js';
import { spawnGem } from '../game/gems.js';
import { pickChoices } from '../game/skills.js';

export const ARENA_BOUNDS = { w: 3000, h: 2000 };

// Initial tuning; expect to change these in play.
export const BASE_RATE = 1; // enemies per second at t = 0
export const RATE_PER_SEC = 0.02; // added per second survived
export const ENEMY_CAP = 800; // live enemies; the director stops spawning above this
export const SHOOTER_AFTER = 60; // seconds before shooters join the mix
export const SHOOTER_SHARE = 0.3;
export const BOSS_EVERY = 120; // seconds
const SPAWN_MARGIN = 60; // px beyond the view's corner
const SPAWN_DEPTH = 300; // spawn distances run from the ring to ring + depth
const WALL_PAD = 20;
const VIEW_PAD = 40; // spawn centres stay this far outside the view so a big enemy is not partly on screen
const TRIES = 32;

export const xpFor = (level) => 5 + 5 * level;
export const spawnRate = (t) => BASE_RATE + RATE_PER_SEC * t;

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Writes a spawn position to `out` and returns true. The point is on a ring just outside the view
// around the player and inside the world; points that miss are rejected, not clamped, so a player
// near a wall never gets a spawn in view. Returns false if no point fits (the director retries
// next tick).
export function spawnPoint(game, out) {
  const { player, bounds, camera, view, rng } = game;
  const ring = Math.hypot(view.w, view.h) / 2 + SPAWN_MARGIN;
  for (let k = 0; k < TRIES; k++) {
    const a = rng() * Math.PI * 2;
    const d = ring + rng() * SPAWN_DEPTH;
    const x = player.x + Math.cos(a) * d;
    const y = player.y + Math.sin(a) * d;
    if (x < WALL_PAD || x > bounds.w - WALL_PAD || y < WALL_PAD || y > bounds.h - WALL_PAD) continue;
    if (x >= camera.x - VIEW_PAD && x <= camera.x + view.w + VIEW_PAD && y >= camera.y - VIEW_PAD && y <= camera.y + view.h + VIEW_PAD) continue;
    out.x = x;
    out.y = y;
    return true;
  }
  return false;
}

export function createArena() {
  const pt = { x: 0, y: 0 };
  return {
    debt: 0, // fractional enemies owed by the director
    nextBoss: BOSS_EVERY,

    start(game) {
      this.debt = 0;
      this.nextBoss = BOSS_EVERY;
      game.player.x = game.bounds.w / 2;
      game.player.y = game.bounds.h / 2;
    },

    update(game, dt) {
      const { world, rng } = game;
      this.debt += spawnRate(game.time) * dt;
      while (this.debt >= 1) {
        if (world.kindCount[KIND.ENEMY] >= ENEMY_CAP) {
          this.debt = 0;
          break;
        }
        if (!spawnPoint(game, pt)) break;
        this.debt -= 1;
        const shooter = game.time >= SHOOTER_AFTER && rng() < SHOOTER_SHARE;
        spawnEnemy(world, shooter ? ENEMY.SHOOTER : ENEMY.CHASER, pt.x, pt.y);
      }
      if (game.time >= this.nextBoss && spawnPoint(game, pt)) {
        spawnEnemy(world, ENEMY.BOSS, pt.x, pt.y);
        this.nextBoss += BOSS_EVERY;
      }
      const need = xpFor(game.level);
      if (game.xp >= need) {
        game.xp -= need;
        game.level++;
        game.offer = pickChoices(rng, 3);
      }
    },

    onChosen() {},

    onKill(game, j) {
      const value = ENEMY_TYPES[game.world.type[j]].xp;
      if (value > 0) spawnGem(game.world, game.world.x[j], game.world.y[j], value);
    },

    hud: (game) => `Lv ${game.level}  XP ${Math.floor(game.xp)}/${xpFor(game.level)}  ${clock(game.time)}`,
    summary: (game) => `level ${game.level}, survived ${clock(game.time)}`,
  };
}
