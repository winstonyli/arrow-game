import { KIND } from '../../core/world.ts';
import { hitEnemy, HIT_STATUS, HIT_TICK } from '../hit.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const FIRE_CAP = 64; // patches alive at once; the oldest is overwritten when the ring is full
export const FIRE_SPACING = 20; // px the player moves between drops
export const FIRE_TICK = 0.25; // seconds between a patch's damage ticks
export const FIRE_ALPHA = 0.35; // presentation only: a patch's opacity cap (it fades from here); opaque patches hid enemies and shots
export const FLAME_LEVELS = [
  { dps: 8, life: 2, radius: 14 },
  { dps: 12, life: 2.5, radius: 16 },
  { dps: 16, life: 3, radius: 18 },
  { dps: 22, life: 3.5, radius: 20 },
  { dps: 30, life: 4, radius: 24 },
];

// A fixed ring of fire patches (parallel arrays; a patch is live while life > 0). `head` is the next slot to write;
// (lx, ly) is the last drop point once `started`. Presentation reads x/y/life and never writes them.
export interface FireState { head: number; started: boolean; lx: number; ly: number; x: Float32Array; y: Float32Array; life: Float32Array; cd: Float32Array }
export const createFireState = (): FireState => ({
  head: 0,
  started: false,
  lx: 0,
  ly: 0,
  x: new Float32Array(FIRE_CAP),
  y: new Float32Array(FIRE_CAP),
  life: new Float32Array(FIRE_CAP),
  cd: new Float32Array(FIRE_CAP),
});

// Ages every patch, ticks each one whose timer is up (every enemy it overlaps takes dps * FIRE_TICK through hitEnemy,
// HIT_STATUS | HIT_TICK: Frost and Ignite apply, no crit, no push, no flash), then drops a new patch at the player when
// they have moved FIRE_SPACING from the last drop. grid must be rebuilt for KIND.ENEMY this tick. Returns kills.
export function updateFlame(game: Game, level: number, dt: number): number {
  const L = FLAME_LEVELS[level - 1];
  const f = game.wstate.fire;
  const { world, grid, player } = game;
  const dmg = L.dps * FIRE_TICK * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < FIRE_CAP; k++) {
    if (f.life[k] <= 0) continue;
    f.life[k] -= dt;
    f.cd[k] -= dt;
    if (f.life[k] <= 0 || f.cd[k] > 0) continue;
    f.cd[k] += FIRE_TICK;
    const n = grid.gather(f.x[k], f.y[k], L.radius + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      const ex = world.x[j] - f.x[k];
      const ey = world.y[j] - f.y[k];
      const r = L.radius + world.radius[j];
      if (ex * ex + ey * ey > r * r) continue;
      kills += hitEnemy(game, j, dmg, HIT_STATUS | HIT_TICK, 0, 0);
    }
  }
  const dx = player.x - f.lx;
  const dy = player.y - f.ly;
  if (!f.started || dx * dx + dy * dy >= FIRE_SPACING * FIRE_SPACING) {
    f.started = true;
    f.lx = player.x;
    f.ly = player.y;
    const h = f.head;
    f.x[h] = player.x;
    f.y[h] = player.y;
    f.life[h] = L.life;
    f.cd[h] = 0;
    f.head = (h + 1) % FIRE_CAP;
  }
  return kills;
}

export const FLAME: WeaponDef = {
  id: 'flame',
  name: 'Flame Trail',
  desc: 'Leaves fire behind you that burns enemies standing in it',
  maxLevel: FLAME_LEVELS.length,
  update: updateFlame,
};
