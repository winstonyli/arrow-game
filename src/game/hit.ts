import { KIND } from '../core/world.ts';
import { clamp } from '../core/math.ts';
import type { HitFn } from '../core/systems.ts';
import type { Game } from './game.ts';
import { CRIT_CHANCE, CRIT_MULT, KNOCK_PX } from './modifiers.ts';

// What a hit is, for the modifiers (Tasks 2-5): CRIT = may crit, KNOCK = may push, NOBLAST = its kills do not explode.
export const HIT_CRIT = 1;
export const HIT_KNOCK = 2;
export const HIT_NOBLAST = 4;

// The one place an enemy takes damage. (dx, dy) is the hit's direction (zero when it has none). A slot that is no
// longer an enemy (killed earlier this tick, the grid is older) is rejected. A lethal hit calls onKill before the
// despawn and returns 1; every other hit returns 0.
export function hitEnemy(game: Game, j: number, dmg: number, flags: number, dx: number, dy: number): number {
  const { world } = game;
  if (world.kind[j] !== KIND.ENEMY) return 0;
  const s = game.player.stats;
  if (flags & HIT_CRIT && s.crit > 0 && game.rng() < s.crit * CRIT_CHANCE) dmg *= CRIT_MULT;
  world.hp[j] -= dmg;
  if (world.hp[j] > 0) {
    if (flags & HIT_KNOCK && s.knockback > 0) {
      const m = Math.hypot(dx, dy);
      if (m > 1e-6) {
        const push = (s.knockback * KNOCK_PX) / m;
        world.x[j] = clamp(world.x[j] + dx * push, world.radius[j], game.bounds.w - world.radius[j]);
        world.y[j] = clamp(world.y[j] + dy * push, world.radius[j], game.bounds.h - world.radius[j]);
      }
    }
    return 0;
  }
  game.onKill?.(j);
  world.despawn(j);
  return 1;
}

// The callbacks tick hands to collisionSystem and orbitSystem. Built once per game so tick allocates nothing.
export interface Hits { arrow: HitFn; blade: HitFn }
export function createHits(game: Game): Hits {
  return {
    arrow: (j, dmg, dx, dy) => hitEnemy(game, j, dmg, HIT_CRIT | HIT_KNOCK, dx, dy),
    blade: (j, dmg) => hitEnemy(game, j, dmg, 0, 0, 0),
  };
}
