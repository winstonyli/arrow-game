// The steering bot used by the soak and balance scripts, with its tunable numbers pulled out into BotParams.
// DEFAULT_PARAMS reproduces the hand-set `smart` bot exactly (scripts/soak-arena.ts checks nothing else changed);
// scripts/evolve-bot.ts searches for better numbers inside BOUNDS and writes them to scripts/bot-params.json (`--bot=evolved`).
import { createGame, tick, choose } from '../../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../../src/modes/arena.ts';
import { ENEMY } from '../../src/game/enemies.ts';
import { seeded } from '../../src/core/math.ts';
import { applySkill } from '../../src/game/skills.ts';
import { KIND } from '../../src/core/world.ts';
import type { Game } from '../../src/game/game.ts';

export interface BotParams {
  flee: number; // px: enemies and enemy shots closer than this push the bot away
  fall: number; // exponent on the (flee - d) / flee falloff: higher = only close threats matter
  wShooter: number; // flee weight multipliers by threat type (1 = same as a chaser)
  wBoss: number;
  wSwarm: number;
  wShot: number; // enemy projectiles
  wallMargin: number; // px: walls push back inside this distance
  wallWeight: number;
  side: number; // sidestep share: circle the threats instead of backing straight off
  gemPull: number; // weight of the pull toward the nearest gem while fleeing
  gemRange: number; // px: the nearest gem pulls only inside this distance
}

export const DEFAULT_PARAMS: BotParams = { flee: 260, fall: 1, wShooter: 1, wBoss: 1, wSwarm: 1, wShot: 1, wallMargin: 250, wallWeight: 1, side: 0.5, gemPull: 0.7, gemRange: 400 };

// [min, max] the evolution may use; defaults sit inside.
export const BOUNDS: Record<keyof BotParams, [number, number]> = {
  flee: [120, 500], fall: [0.3, 3], wShooter: [0, 4], wBoss: [0, 4], wSwarm: [0, 4], wShot: [0, 4],
  wallMargin: [80, 500], wallWeight: [0, 4], side: [0, 1.5], gemPull: [0, 2], gemRange: [50, 800],
};
export const PARAM_KEYS = Object.keys(DEFAULT_PARAMS) as (keyof BotParams)[];

// Smart bot skill priority, first wins: weapons, then the six modifiers, then the other upgrades. Unlisted ids sort first (indexOf -1), so list every id.
export const PRIORITY = ['multishot', 'rapid', 'power', 'shockwave', 'shockwave.a', 'shockwave.b', 'chain', 'chain.a', 'chain.b', 'blade', 'blade.a', 'blade.b', 'boomerang', 'flame', 'mines', 'meteor', 'beam', 'drone', 'drone.a', 'drone.b', 'daggers', 'crit', 'explode', 'vamp', 'frost', 'ignite', 'knockback', 'homing', 'pierce', 'regen', 'ricochet', 'magnet', 'swift'];

// Flee threats within p.flee px (weighted by type and by distance), push off walls, and with nothing near, chase the nearest gem.
// `smart` adds the sidestep and keeps collecting nearby gems while fleeing; the `kite` bot is the plain version.
export function makeSteer(p: BotParams, smart: boolean): (g: Game) => void {
  return (g) => {
    const { world, player, bounds } = g;
    let fx = 0, fy = 0, gx = 0, gy = 0, gd = Infinity;
    for (let i = 0; i < world.high; i++) {
      const k = world.kind[i];
      if (k === KIND.NONE) continue;
      const dx = player.x - world.x[i], dy = player.y - world.y[i];
      const d = Math.hypot(dx, dy) || 1;
      if (k === KIND.GEM) { if (d < gd) { gd = d; gx = -dx / d; gy = -dy / d; } continue; }
      if (k === KIND.PROJECTILE || d > p.flee) continue;
      const t = world.type[i];
      const kind = k === KIND.ENEMY_PROJECTILE ? p.wShot : t === ENEMY.SHOOTER ? p.wShooter : t === ENEMY.BOSS ? p.wBoss : t === ENEMY.SWARMER ? p.wSwarm : 1;
      const w = (kind * ((p.flee - d) / p.flee) ** p.fall) / d;
      fx += dx * w; fy += dy * w;
    }
    const M = p.wallMargin;
    fx += (Math.max(0, M - player.x) / M - Math.max(0, M - (bounds.w - player.x)) / M) * p.wallWeight;
    fy += (Math.max(0, M - player.y) / M - Math.max(0, M - (bounds.h - player.y)) / M) * p.wallWeight;
    let m = Math.hypot(fx, fy);
    if (smart && m > 0.02) {
      const near = gd < p.gemRange ? p.gemPull : 0; // keep collecting while fleeing
      const sx = -fy / m * p.side, sy = fx / m * p.side; // sidestep: circle rather than back into a wall
      fx = fx / m + sx + gx * near;
      fy = fy / m + sy + gy * near;
      m = Math.hypot(fx, fy);
    }
    if (m > 0.02) { g.input.x = fx / m; g.input.y = fy / m; } else if (gd < Infinity) { g.input.x = gx; g.input.y = gy; } else { g.input.x = 0; g.input.y = 0; }
  };
}

export const pickSmart = (offer: string[]): string => [...offer].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];

// Headless smart-bot run for the evolution: returns the seconds survived (capped at `minutes`) and the kill count.
// `grant` ids are applied before the first tick, as in soak-arena --grant.
export function runHeadless(p: BotParams, seed: number, grant: string[], minutes: number): { secs: number; died: boolean; kills: number } {
  const g = createGame({ capacity: 50000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(seed), input: { x: 0, y: 0 } });
  for (const id of grant) { applySkill(g.player.stats, id); g.skills[id] = (g.skills[id] ?? 0) + 1; }
  const steer = makeSteer(p, true);
  const ticks = Math.round(minutes * 3600);
  for (let k = 0; k < ticks && !g.over; k++) {
    if (g.offer) choose(g, pickSmart(g.offer));
    steer(g);
    tick(g, 1 / 60);
  }
  return { secs: g.time, died: g.over, kills: g.kills };
}
