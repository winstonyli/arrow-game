import { KIND } from '../../core/world.ts';
import { hitEnemy } from '../hit.ts';
import { HIT_FLAGS } from '../coverage.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const MINE_CAP = 48; // slots in the pool; the live count settles near MINE_LIFE / interval (about 4 to 7), so it never fills in practice
export const MINE_SPACING = 20; // px the player must be from the last drop before another mine drops
export const MINE_LIFE = 12; // seconds a mine lasts; it expires without detonating
export const MINE_ARM = 0.5; // seconds before a mine can trigger
export const MINE_TRIGGER = 30; // px (plus the enemy's radius) at which an armed mine detonates
export const MINE_RADIUS = 6; // drawn size (presentation only)
export const MINE_FADE = 1.5; // seconds a dying mine fades over (presentation only)
export const MINE_UNARMED_ALPHA = 0.35; // an unarmed mine's opacity (presentation only)
const MINE_PAL = -1; // render/fx PAL_GEM (gold), the same value as BLAST_PAL in hit.ts; the sim does not import render code
export const MINE_LEVELS = [
  { dmg: 40, radius: 60, interval: 3 },
  { dmg: 55, radius: 66, interval: 2.7 },
  { dmg: 75, radius: 72, interval: 2.4 },
  { dmg: 100, radius: 80, interval: 2.1 },
  { dmg: 135, radius: 90, interval: 1.8 },
];

// A fixed pool of mines (parallel arrays; a slot is live while on[k] is 1). `cd` is the drop timer; (lx, ly) is the
// last drop point once `started`. Presentation reads x/y/age/on and never writes them.
export interface MineState { started: boolean; lx: number; ly: number; cd: number; x: Float32Array; y: Float32Array; age: Float32Array; on: Uint8Array }
export const createMineState = (): MineState => ({
  started: false,
  lx: 0,
  ly: 0,
  cd: 0,
  x: new Float32Array(MINE_CAP),
  y: new Float32Array(MINE_CAP),
  age: new Float32Array(MINE_CAP),
  on: new Uint8Array(MINE_CAP),
});

// A mine's opacity: dim until armed, then solid, fading to nothing over its last MINE_FADE seconds.
export function mineAlpha(age: number): number {
  const base = age >= MINE_ARM ? 1 : MINE_UNARMED_ALPHA;
  return base * Math.min(1, (MINE_LIFE - age) / MINE_FADE);
}

// True when an enemy is inside the trigger of the mine at (x, y). Reads grid.out completely before returning.
function tripped(game: Game, x: number, y: number): boolean {
  const { world, grid } = game;
  const n = grid.gather(x, y, MINE_TRIGGER + grid.maxRadius);
  for (let q = 0; q < n; q++) {
    const j = grid.out[q];
    if (world.kind[j] !== KIND.ENEMY) continue;
    const ex = world.x[j] - x;
    const ey = world.y[j] - y;
    const r = MINE_TRIGGER + world.radius[j];
    if (ex * ex + ey * ey <= r * r) return true;
  }
  return false;
}

// Ages every mine (expiring the old), detonates each armed mine an enemy has tripped (the mine is cleared first, then
// every enemy in the blast takes the level's damage through hitEnemy, flags from the coverage table), then
// drops a new mine at the player when the timer and spacing allow. grid must be rebuilt for KIND.ENEMY this tick.
// Returns kills.
export function updateMines(game: Game, level: number, dt: number): number {
  const L = MINE_LEVELS[level - 1];
  const m = game.wstate.mines;
  const { world, grid, player } = game;
  const dmg = L.dmg * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < MINE_CAP; k++) {
    if (!m.on[k]) continue;
    m.age[k] += dt;
    if (m.age[k] >= MINE_LIFE) {
      m.on[k] = 0;
      continue;
    }
    if (m.age[k] < MINE_ARM) continue;
    const mx = m.x[k];
    const my = m.y[k];
    if (!tripped(game, mx, my)) continue;
    m.on[k] = 0;
    game.fx?.kill(mx, my, L.radius, MINE_PAL);
    const n = grid.gather(mx, my, L.radius + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      const ex = world.x[j] - mx;
      const ey = world.y[j] - my;
      const r = L.radius + world.radius[j];
      if (ex * ex + ey * ey > r * r) continue;
      kills += hitEnemy(game, j, dmg, HIT_FLAGS.mines, ex, ey);
    }
  }
  m.cd -= dt;
  const dx = player.x - m.lx;
  const dy = player.y - m.ly;
  if (m.cd <= 0 && (!m.started || dx * dx + dy * dy >= MINE_SPACING * MINE_SPACING)) {
    const f = m.on.indexOf(0);
    if (f >= 0) {
      m.started = true;
      m.lx = player.x;
      m.ly = player.y;
      m.x[f] = player.x;
      m.y[f] = player.y;
      m.age[f] = 0;
      m.on[f] = 1;
      m.cd = L.interval * player.stats.cooldownMult;
    }
  }
  return kills;
}

export const MINES: WeaponDef = {
  id: 'mines',
  name: 'Breadcrumbs',
  desc: 'You drop little bombs as you go, and enemies that follow set them off',
  maxLevel: MINE_LEVELS.length,
  update: updateMines,
};
