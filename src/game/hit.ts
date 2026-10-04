import { KIND } from '../core/world.ts';
import { clamp } from '../core/math.ts';
import type { HitFn } from '../core/systems.ts';
import type { Game } from './game.ts';
import { BLAST_BASE, BLAST_CAP, BLAST_DMG, BLAST_PER, CRIT_CHANCE, CRIT_MULT, FROST_SECS, IGNITE_DPS, IGNITE_SECS, KNOCK_PX, VAMP_HP } from './modifiers.ts';

// What a hit is, for the modifiers (Tasks 2-5): CRIT = may crit, KNOCK = may push, NOBLAST = its kills do not explode, STATUS = a surviving hit starts Frost and Ignite.
export const HIT_CRIT = 1;
export const HIT_KNOCK = 2;
export const HIT_NOBLAST = 4;
export const HIT_STATUS = 8; // applies Frost / Ignite to a survivor
const BLAST_PAL = -1; // render/fx PAL_GEM (gold); the sim does not import render code

// Positions of kills that explode this tick, drained by explosionSystem. Fixed size; empty between ticks, so it is
// not hashed.
export interface Blasts { n: number; x: Float32Array; y: Float32Array }
export const createBlasts = (): Blasts => ({ n: 0, x: new Float32Array(BLAST_CAP), y: new Float32Array(BLAST_CAP) });

// The one place an enemy takes damage. (dx, dy) is the hit's direction (zero when it has none). A slot that is no
// longer a live enemy (killed earlier this tick, the grid is older) is rejected. A lethal hit calls onKill before the
// despawn and returns 1; every other hit returns 0. Modifiers apply here: HIT_CRIT hits may crit (rolled on game.rng),
// a surviving HIT_KNOCK hit is pushed back along (dx, dy), a kill heals the player (vamp) and queues a blast for
// explosionSystem unless the hit is HIT_NOBLAST. A surviving HIT_STATUS hit refreshes slowT / burnT to the full
// duration for each owned status (frost, ignite).
export function hitEnemy(game: Game, j: number, dmg: number, flags: number, dx: number, dy: number): number {
  const { world } = game;
  if (world.kind[j] !== KIND.ENEMY || world.hp[j] <= 0) return 0;
  const s = game.player.stats;
  if (flags & HIT_CRIT && s.crit > 0 && game.rng() < s.crit * CRIT_CHANCE) {
    dmg *= CRIT_MULT;
    game.fx?.crit(world.x[j], world.y[j]);
  }
  world.hp[j] -= dmg;
  if (world.hp[j] > 0) {
    if (flags & HIT_KNOCK && s.knockback > 0) {
      const m = Math.hypot(dx, dy);
      if (m > 1e-6) {
        const push = (s.knockback * KNOCK_PX) / m;
        const ox = world.x[j];
        const oy = world.y[j];
        world.x[j] = clamp(ox + dx * push, world.radius[j], game.bounds.w - world.radius[j]);
        world.y[j] = clamp(oy + dy * push, world.radius[j], game.bounds.h - world.radius[j]);
        if (world.x[j] !== ox || world.y[j] !== oy) game.fx?.push(ox, oy, world.x[j] - ox, world.y[j] - oy);
      }
    }
    if (flags & HIT_STATUS) {
      if (s.frost > 0) world.slowT[j] = FROST_SECS;
      if (s.ignite > 0) world.burnT[j] = IGNITE_SECS;
    }
    return 0;
  }
  if (s.vamp > 0) game.player.hp = Math.min(game.player.maxHp, game.player.hp + s.vamp * VAMP_HP);
  if (s.explode > 0 && !(flags & HIT_NOBLAST) && game.blasts.n < BLAST_CAP) {
    game.blasts.x[game.blasts.n] = world.x[j];
    game.blasts.y[game.blasts.n] = world.y[j];
    game.blasts.n++;
  }
  game.onKill?.(j);
  world.despawn(j);
  return 1;
}

// The callbacks tick hands to collisionSystem and orbitSystem. Built once per game so tick allocates nothing.
export interface Hits { arrow: HitFn; blade: HitFn }
export function createHits(game: Game): Hits {
  return {
    arrow: (j, dmg, dx, dy) => hitEnemy(game, j, dmg, HIT_CRIT | HIT_KNOCK | HIT_STATUS, dx, dy),
    blade: (j, dmg) => hitEnemy(game, j, dmg, 0, 0, 0),
  };
}

// Runs each queued blast: every enemy that overlaps the blast radius around the point (its edge reaches it) takes the
// level's damage, and a gold ring starting at that radius marks it. Kept out of hitEnemy because a weapon loop may be
// walking grid.out, which gather here would overwrite. The grid is the tick's (built before anything died); hitEnemy
// rejects slots that are gone. Blast hits carry HIT_NOBLAST, so an explosion never queues another. Returns kills.
export function explosionSystem(game: Game): number {
  const b = game.blasts;
  if (b.n === 0) return 0;
  const { world, grid } = game;
  const s = game.player.stats;
  const radius = BLAST_BASE + BLAST_PER * s.explode;
  const dmg = BLAST_DMG * s.explode * s.damageMult;
  let kills = 0;
  for (let k = 0; k < b.n; k++) {
    const x = b.x[k];
    const y = b.y[k];
    game.fx?.kill(x, y, radius, BLAST_PAL);
    const n = grid.gather(x, y, radius + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      if (Math.hypot(world.x[j] - x, world.y[j] - y) > radius + world.radius[j]) continue;
      kills += hitEnemy(game, j, dmg, HIT_NOBLAST, 0, 0);
    }
  }
  b.n = 0;
  return kills;
}

const BURN_EPS = 1e-4;

// Runs the status timers (before explosionSystem, so burn-kill blasts drain the same tick): both count down, and a burning enemy takes IGNITE_DPS per level
// through hitEnemy with no flags, so a burn never crits, pushes or starts a status; its kills still heal and blast.
// Skipped entirely without a status level (timers cannot run without one). Walks the slots by index with `high`
// re-read, since onKill may spawn into a freed slot (the Splitter); that slot is then tested by its own state.
export function statusSystem(game: Game, dt: number): number {
  const s = game.player.stats;
  if (s.frost === 0 && s.ignite === 0) return 0;
  const { world } = game;
  const burn = IGNITE_DPS * s.ignite * s.damageMult * dt;
  let kills = 0;
  for (let i = 0; i < world.high; i++) {
    if (world.kind[i] !== KIND.ENEMY) continue;
    if (world.slowT[i] > 0) world.slowT[i] = Math.max(0, world.slowT[i] - dt);
    if (world.burnT[i] > 0) {
      if (world.burnT[i] <= BURN_EPS) { // float32 countdown residue: expired, so a 3 s burn is exactly 180 ticks
        world.burnT[i] = 0;
        continue;
      }
      world.burnT[i] = Math.max(0, world.burnT[i] - dt);
      kills += hitEnemy(game, i, burn, 0, 0, 0);
    }
  }
  return kills;
}
