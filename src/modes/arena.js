import { KIND } from '../core/world.js';
import { ENEMY, ENEMY_TYPES, spawnEnemy } from '../game/enemies.js';
import { spawnGem } from '../game/gems.js';
import { pickChoices } from '../game/skills.js';
import { clamp } from '../core/math.js';

export const ARENA_BOUNDS = { w: 3000, h: 2000 };

// Initial tuning; expect to change these in play.
export const BASE_RATE = 0.6; // enemies per second at t = 0
export const RATE_PER_SEC = 0.015; // added per second survived
export const ENEMY_CAP = 800; // live enemies; the director stops spawning above this
export const SHOOTER_AFTER = 60; // seconds before shooters join the mix
export const SHOOTER_SHARE = 0.3;
// Enemy mix: from `after` seconds a type takes `share` of spawns (first match wins, in this order);
// the rest are chasers. A swarmer spawn is a pack of `pack` enemies and costs that much of the director's debt.
export const MIX = [
  { type: ENEMY.SHOOTER, after: SHOOTER_AFTER, share: SHOOTER_SHARE, pack: 1 },
  { type: ENEMY.SWARMER, after: 30, share: 0.15, pack: 4 },
  { type: ENEMY.BRUISER, after: 90, share: 0.08, pack: 1 },
  { type: ENEMY.SPLITTER, after: 150, share: 0.08, pack: 1 },
];
const SPLIT_COUNT = 2;
const PACK_SPREAD = 30; // px
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

// The mix entry a spawn at time `t` uses, or null for a chaser. Rolls rng once if any entry is unlocked.
export function pickMix(t, rng) {
  let open = false;
  for (const m of MIX) if (t >= m.after) open = true;
  if (!open) return null;
  let r = rng();
  for (const m of MIX) {
    if (t < m.after) continue;
    if (r < m.share) return m;
    r -= m.share;
  }
  return null;
}

export function createArena() {
  const pt = { x: 0, y: 0 };
  return {
    debt: 0, // fractional enemies owed by the director
    nextBoss: BOSS_EVERY,

    start(game) {
      this.debt = 0;
      this.nextBoss = BOSS_EVERY;
      game.player.stats.moveFireRate = 0.5; // kiting: half fire rate while moving
      game.enemyFireOnScreen = true;
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
        const pick = pickMix(game.time, rng);
        const count = pick ? Math.max(1, Math.min(pick.pack, ENEMY_CAP - world.kindCount[KIND.ENEMY])) : 1;
        for (let k = 0; k < count; k++) {
          const dx = k === 0 ? 0 : (rng() - 0.5) * 2 * PACK_SPREAD;
          const dy = k === 0 ? 0 : (rng() - 0.5) * 2 * PACK_SPREAD;
          spawnEnemy(world, pick ? pick.type : ENEMY.CHASER, clamp(pt.x + dx, WALL_PAD, game.bounds.w - WALL_PAD), clamp(pt.y + dy, WALL_PAD, game.bounds.h - WALL_PAD));
        }
        this.debt -= count - 1;
      }
      if (game.time >= this.nextBoss && spawnPoint(game, pt)) {
        spawnEnemy(world, ENEMY.BOSS, pt.x, pt.y);
        game.fx?.shake(0.6);
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
      const { world } = game;
      if (world.type[j] === ENEMY.SPLITTER) {
        for (let k = 0; k < SPLIT_COUNT && world.kindCount[KIND.ENEMY] < ENEMY_CAP; k++) {
          const a = game.rng() * Math.PI * 2;
          spawnEnemy(world, ENEMY.SWARMER, clamp(world.x[j] + Math.cos(a) * 14, WALL_PAD, game.bounds.w - WALL_PAD), clamp(world.y[j] + Math.sin(a) * 14, WALL_PAD, game.bounds.h - WALL_PAD));
        }
      }
      const value = ENEMY_TYPES[world.type[j]].xp;
      if (value > 0) {
        spawnGem(game.world, game.world.x[j], game.world.y[j], value);
        game.fx?.burst(game.world.x[j], game.world.y[j]);
      }
    },

    hud: (game) => `Lv ${game.level}  XP ${Math.floor(game.xp)}/${xpFor(game.level)}  ${clock(game.time)}`,
    summary: (game) => `level ${game.level}, survived ${clock(game.time)}`,
  };
}
