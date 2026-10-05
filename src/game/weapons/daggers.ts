import { KIND } from '../../core/world.ts';
import { hitEnemy, HIT_CRIT, HIT_STATUS } from '../hit.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const DAGGER_CAP = 14; // one level-5 volley (7) lives about 0.57 s, under the 0.8 s interval; extra Rapid Fire can overlap volleys, and a full pool skips daggers
export const DAGGER_SPEED = 700; // px/s
export const DAGGER_RADIUS = 6;
export const DAGGER_SPREAD = 0.18; // rad between neighbouring daggers in a fan
export const DAGGER_MOVE_MIN = 20; // px/s: slower than this the player counts as still and the fan aims at the nearest enemy
export const DAGGER_DOT_R = 3; // the drawn radius of each dot (presentation only)
export const DAGGER_TRAIL: ReadonlyArray<readonly [number, number]> = [[5, 0.6], [10, 0.3]]; // trailing dots: px behind the head, alpha (presentation only)
export const DAGGER_INSTANCES = DAGGER_CAP * (1 + DAGGER_TRAIL.length); // the WebGL buffer's share: a head and its trail per dagger
export const DAGGER_LEVELS = [
  { count: 3, dmg: 18, pierce: 1, interval: 1.0, range: 320 },
  { count: 3, dmg: 24, pierce: 1, interval: 0.9, range: 340 },
  { count: 5, dmg: 26, pierce: 2, interval: 0.9, range: 360 },
  { count: 5, dmg: 34, pierce: 2, interval: 0.8, range: 380 },
  { count: 7, dmg: 38, pierce: 3, interval: 0.8, range: 400 },
];

// A slot is live while on[k] is 1. (dx, dy) is its unit direction, `left` the range still to fly, `pierce` the hits it
// has left beyond the next one, and (lastHit, lastGen) the enemy it hit last (the bow's rule: it is skipped while it
// still overlaps). `cd` is the volley timer. Presentation reads these and never writes them.
export interface DaggerState { on: Uint8Array; x: Float32Array; y: Float32Array; dx: Float32Array; dy: Float32Array; left: Float32Array; pierce: Uint8Array; lastHit: Int32Array; lastGen: Uint16Array; cd: number }
export const createDaggerState = (): DaggerState => ({
  on: new Uint8Array(DAGGER_CAP),
  x: new Float32Array(DAGGER_CAP),
  y: new Float32Array(DAGGER_CAP),
  dx: new Float32Array(DAGGER_CAP),
  dy: new Float32Array(DAGGER_CAP),
  left: new Float32Array(DAGGER_CAP),
  pierce: new Uint8Array(DAGGER_CAP),
  lastHit: new Int32Array(DAGGER_CAP).fill(-1),
  lastGen: new Uint16Array(DAGGER_CAP), // world.gen's type
  cd: 0,
});

// When the volley timer allows and there is an aim (the player's velocity above DAGGER_MOVE_MIN, else the nearest enemy
// within range), launches a fan of the level's daggers from the player into free slots (a full pool skips the rest).
// Then every older live dagger flies DAGGER_SPEED, is freed once it has flown its range, and hits each enemy it
// overlaps through hitEnemy (HIT_CRIT | HIT_STATUS: no push, no HIT_TICK), skipping the one it hit last and spending a
// pierce per hit (freed on the hit after its last pierce). Draws no rng. Returns kills. grid must be rebuilt for
// KIND.ENEMY this tick.
export function updateDaggers(game: Game, level: number, dt: number): number {
  const L = DAGGER_LEVELS[level - 1];
  const d = game.wstate.daggers;
  const { world, grid, player } = game;
  let fresh = 0; // bit k: slot k launched this update (it moves from the next one)
  d.cd = Math.max(0, d.cd - dt);
  if (d.cd === 0) {
    let ax = 0;
    let ay = 0;
    let aimed = false;
    if (Math.hypot(player.vx, player.vy) > DAGGER_MOVE_MIN) {
      ax = player.vx;
      ay = player.vy;
      aimed = true;
    } else {
      const t = grid.nearest(world, player.x, player.y, L.range);
      if (t >= 0) {
        ax = world.x[t] - player.x;
        ay = world.y[t] - player.y;
        if (Math.hypot(ax, ay) < 1e-6) { ax = 1; ay = 0; }
        aimed = true;
      }
    }
    if (aimed) {
      const base = Math.atan2(ay, ax);
      let k = 0;
      for (let i = 0; i < L.count; i++) {
        while (k < DAGGER_CAP && d.on[k]) k++;
        if (k === DAGGER_CAP) break; // full: the rest of this volley is skipped
        const a = base + (i - (L.count - 1) / 2) * DAGGER_SPREAD;
        d.on[k] = 1;
        d.x[k] = player.x;
        d.y[k] = player.y;
        d.dx[k] = Math.cos(a);
        d.dy[k] = Math.sin(a);
        d.left[k] = L.range;
        d.pierce[k] = L.pierce;
        d.lastHit[k] = -1;
        d.lastGen[k] = 0;
        fresh |= 1 << k;
      }
      d.cd = L.interval * player.stats.cooldownMult;
    }
  }
  const step = DAGGER_SPEED * dt;
  const dmg = L.dmg * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < DAGGER_CAP; k++) {
    if (!d.on[k] || fresh & (1 << k)) continue;
    d.x[k] += d.dx[k] * step;
    d.y[k] += d.dy[k] * step;
    d.left[k] -= step;
    if (d.left[k] <= 0) {
      d.on[k] = 0; // flown its range: no hit test on this move
      continue;
    }
    const n = grid.gather(d.x[k], d.y[k], DAGGER_RADIUS + grid.maxRadius);
    for (let q = 0; q < n; q++) {
      const j = grid.out[q];
      if (world.kind[j] !== KIND.ENEMY) continue;
      if (j === d.lastHit[k] && world.gen[j] === d.lastGen[k]) continue; // still overlapping the one it just hit
      const rr = DAGGER_RADIUS + world.radius[j];
      if ((world.x[j] - d.x[k]) ** 2 + (world.y[j] - d.y[k]) ** 2 > rr * rr) continue;
      d.lastHit[k] = j; // all slot state before the hit: a kill bumps gen and can refill slots through onKill
      d.lastGen[k] = world.gen[j];
      const spent = d.pierce[k] === 0;
      if (spent) d.on[k] = 0;
      else d.pierce[k]--;
      kills += hitEnemy(game, j, dmg, HIT_CRIT | HIT_STATUS, d.dx[k], d.dy[k]);
      if (spent) break;
    }
  }
  return kills;
}

export const DAGGERS: WeaponDef = {
  id: 'daggers',
  name: 'Pincushion',
  desc: 'A fan of pointy blades flies ahead of you and skewers everything in the way',
  maxLevel: DAGGER_LEVELS.length,
  update: updateDaggers,
};
