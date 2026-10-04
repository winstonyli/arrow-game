import { KIND } from '../../core/world.ts';
import { hitEnemy } from '../hit.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const BOOM_SPEED = 450; // px/s, out and back
export const BOOM_RADIUS = 10;
export const BOOM_CATCH = 14; // px from the player at which a returning boomerang is caught
export const BOOM_RELAUNCH = 1; // seconds idle after a catch
export const BOOM_STAGGER = 0.35; // seconds between the boomerangs' first launches
export const BOOM_LEVELS = [
  { count: 1, range: 300, dps: 40 },
  { count: 1, range: 330, dps: 50 },
  { count: 2, range: 360, dps: 60 },
  { count: 2, range: 390, dps: 75 },
  { count: 3, range: 420, dps: 90 },
];
export const MAX_BOOMS = BOOM_LEVELS[BOOM_LEVELS.length - 1].count;

// phase: 0 idle (counting `cd` down), 1 outbound along (dx, dy), 2 returning to the player. `dist` is the distance flown outbound.
export interface Boom { phase: 0 | 1 | 2; x: number; y: number; dx: number; dy: number; dist: number; cd: number }
export interface BoomState { b: Boom[] }
export const createBoomState = (): BoomState => ({
  b: Array.from({ length: MAX_BOOMS }, (_, i) => ({ phase: 0 as const, x: 0, y: 0, dx: 0, dy: 0, dist: 0, cd: i * BOOM_STAGGER })),
});

// Each boomerang launches at the nearest enemy in range, flies `range` px, turns and comes back to the player, damaging
// every enemy it overlaps at the level's damage rate (no world entity, like the blades). grid must be rebuilt for
// KIND.ENEMY this tick. Returns kills.
export function updateBoomerang(game: Game, level: number, dt: number): number {
  const L = BOOM_LEVELS[level - 1];
  const { world, grid, player } = game;
  const step = BOOM_SPEED * dt;
  const dmg = L.dps * player.stats.damageMult * dt;
  let kills = 0;
  for (let i = 0; i < L.count; i++) {
    const b = game.wstate.boom.b[i];
    if (b.phase === 0) {
      b.cd = Math.max(0, b.cd - dt);
      if (b.cd > 0) continue;
      const t = grid.nearest(world, player.x, player.y, L.range);
      if (t < 0) continue;
      const ax = world.x[t] - player.x;
      const ay = world.y[t] - player.y;
      const d = Math.hypot(ax, ay);
      b.dx = d > 1e-6 ? ax / d : 1;
      b.dy = d > 1e-6 ? ay / d : 0;
      b.x = player.x;
      b.y = player.y;
      b.dist = 0;
      b.phase = 1;
      continue; // starts moving next tick
    }
    if (b.phase === 1) {
      b.x += b.dx * step;
      b.y += b.dy * step;
      b.dist += step;
      if (b.dist >= L.range) b.phase = 2;
    } else {
      const ex = player.x - b.x;
      const ey = player.y - b.y;
      const d = Math.hypot(ex, ey);
      if (d <= BOOM_CATCH + step) {
        b.phase = 0;
        b.cd = BOOM_RELAUNCH * player.stats.cooldownMult;
        continue;
      }
      b.x += (ex / d) * step;
      b.y += (ey / d) * step;
    }
    const n = grid.gather(b.x, b.y, BOOM_RADIUS + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      const rr = BOOM_RADIUS + world.radius[j];
      if ((world.x[j] - b.x) ** 2 + (world.y[j] - b.y) ** 2 > rr * rr) continue;
      kills += hitEnemy(game, j, dmg, 0, 0, 0);
    }
  }
  return kills;
}

export const BOOMERANG: WeaponDef = {
  id: 'boomerang',
  name: 'Boomerang',
  desc: 'Flies out and back, cutting everything it touches',
  maxLevel: BOOM_LEVELS.length,
  update: updateBoomerang,
};
