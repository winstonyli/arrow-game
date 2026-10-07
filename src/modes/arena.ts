import { KIND } from '../core/world.ts';
import { ENEMY, ENEMY_TYPES, spawnEnemy } from '../game/enemies.ts';
import { spawnGem } from '../game/gems.ts';
import { pickChoices } from '../game/skills.ts';
import { clamp } from '../core/math.ts';
import type { Vec } from '../core/math.ts';
import type { Game } from '../game/game.ts';

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
const SPAWN_RING = 560; // px from the player: the sim view is square and each screen crops it, so the ring is not derived from it (the narrowest crop shows about 230 px each side)
const SPAWN_DEPTH = 300; // other enemies: distances run from the ring to ring + depth, skewed toward the inner edge (see spawnPoint)
const SHOOTER_RING = 380; // shooters spawn closer, inside their fire range and the sim view, so they are in play when they start shooting
const SHOOTER_DEPTH = 100;
const WALL_PAD = 20;
const TRIES = 32;

export const xpFor = (level: number): number => 5 + 5 * level;
export const spawnRate = (t: number): number => BASE_RATE + RATE_PER_SEC * t;

export const clock = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Writes a spawn position to `out` and returns true. The point is on a ring around the player and inside the world;
// points that miss are rejected, not clamped. Shooters use the closer ring (SHOOTER_RING, uniform); everything else
// SPAWN_RING plus SPAWN_DEPTH * u^2, so most arrive near the inner edge and a few from further out.
// Returns false if no point fits (the director retries next tick).
export function spawnPoint(game: Game, out: Vec, shooter = false): boolean {
  const { player, bounds, rng } = game;
  for (let k = 0; k < TRIES; k++) {
    const a = rng() * Math.PI * 2;
    const u = rng();
    const d = shooter ? SHOOTER_RING + u * SHOOTER_DEPTH : SPAWN_RING + u * u * SPAWN_DEPTH;
    const x = player.x + Math.cos(a) * d;
    const y = player.y + Math.sin(a) * d;
    if (x < WALL_PAD || x > bounds.w - WALL_PAD || y < WALL_PAD || y > bounds.h - WALL_PAD) continue;
    out.x = x;
    out.y = y;
    return true;
  }
  return false;
}

// The mix entry a spawn at time `t` uses, or null for a chaser. Rolls rng once if any entry is unlocked.
export function pickMix(t: number, rng: () => number) {
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

    start(game: Game) {
      this.debt = 0;
      this.nextBoss = BOSS_EVERY;
      game.player.stats.moveFireRate = 0.5; // kiting: half fire rate while moving
      game.enemyFireOnScreen = true;
      game.player.x = game.bounds.w / 2;
      game.player.y = game.bounds.h / 2;
    },

    update(game: Game, dt: number) {
      const { world, rng } = game;
      this.debt += spawnRate(game.time) * dt;
      while (this.debt >= 1) {
        if (world.kindCount[KIND.ENEMY] >= ENEMY_CAP) {
          this.debt = 0;
          break;
        }
        const pick = pickMix(game.time, rng);
        if (!spawnPoint(game, pt, pick?.type === ENEMY.SHOOTER)) break;
        this.debt -= 1;
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
        game.sfx?.boss();
        game.bossAt = game.time;
        this.nextBoss += BOSS_EVERY;
      }
      const need = xpFor(game.level);
      if (game.xp >= need) {
        game.xp -= need;
        game.level++;
        game.offer = pickChoices(rng, 3, game.player.stats, true);
      }
    },

    onChosen() {},

    onKill(game: Game, j: number) {
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

    hud: (game: Game) => `Lv ${game.level}  XP ${Math.floor(game.xp)}/${xpFor(game.level)}  ${clock(game.time)}`,
    summary: (game: Game) => `level ${game.level}, survived ${clock(game.time)}`,
  };
}
