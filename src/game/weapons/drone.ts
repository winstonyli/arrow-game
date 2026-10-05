import { hitEnemy, HIT_CRIT, HIT_STATUS } from '../hit.ts';
import type { Game } from '../game.ts';
import type { WeaponDef } from '../weapons.ts';

export const DRONE_MAX = 3;
export const DRONE_FOLLOW = 6; // per second: each update a drone closes min(1, DRONE_FOLLOW * dt) of the gap to its target point
export const DRONE_STAGGER = 0.15; // seconds between the drones' first shots
export const DRONE_TRACER = Math.fround(0.08); // seconds a shot's tracer is drawn (presentation only); f32-exact so a spent age (stored in a Float32Array) compares >= it
export const DRONE_DOT_R = 5; // the drone's drawn radius (presentation only)
export const DRONE_TRACER_DOTS = 6; // dots in a tracer (presentation only)
export const DRONE_INSTANCES = DRONE_MAX * (1 + DRONE_TRACER_DOTS); // the WebGL buffer's share: a body and a tracer per drone
export const DRONE_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-32, -32], [32, -32], [0, 36]]; // screen-space, from the player
export const DRONE_LEVELS = [
  { count: 1, dmg: 10, interval: 0.6, range: 220 },
  { count: 1, dmg: 14, interval: 0.55, range: 240 },
  { count: 2, dmg: 16, interval: 0.5, range: 260 },
  { count: 2, dmg: 22, interval: 0.45, range: 280 },
  { count: 3, dmg: 26, interval: 0.45, range: 300 },
];

// A slot is active while on[k] is 1. (tx, ty) is where its last shot landed and `age` is that tracer's age (DRONE_TRACER
// once spent). Presentation reads these and never writes them.
export interface DroneState { on: Uint8Array; x: Float32Array; y: Float32Array; cd: Float32Array; tx: Float32Array; ty: Float32Array; age: Float32Array }
export const createDroneState = (): DroneState => ({
  on: new Uint8Array(DRONE_MAX),
  x: new Float32Array(DRONE_MAX),
  y: new Float32Array(DRONE_MAX),
  cd: new Float32Array(DRONE_MAX),
  tx: new Float32Array(DRONE_MAX),
  ty: new Float32Array(DRONE_MAX),
  age: new Float32Array(DRONE_MAX).fill(DRONE_TRACER),
});

// A tracer's opacity: 1 at the shot, falling linearly to 0 at DRONE_TRACER (shared by both renderers).
export const droneAlpha = (age: number): number => Math.max(0, Math.min(1, 1 - age / DRONE_TRACER));

// Each active drone (slots below the level's count, in index order) eases toward player + its offset (a newly active one
// snaps there), then, when its timer allows, hits the nearest enemy within the level's range of the DRONE through
// hitEnemy (HIT_CRIT | HIT_STATUS: no push, no HIT_TICK) and starts its interval and tracer. With no target it waits with
// the timer at 0. Returns kills. grid must be rebuilt for KIND.ENEMY this tick.
export function updateDrone(game: Game, level: number, dt: number): number {
  const L = DRONE_LEVELS[level - 1];
  const d = game.wstate.drones;
  const { world, grid, player } = game;
  const follow = Math.min(1, DRONE_FOLLOW * dt);
  const dmg = L.dmg * player.stats.damageMult;
  let kills = 0;
  for (let k = 0; k < L.count; k++) {
    const px = player.x + DRONE_OFFSETS[k][0];
    const py = player.y + DRONE_OFFSETS[k][1];
    if (!d.on[k]) {
      d.on[k] = 1;
      d.x[k] = px;
      d.y[k] = py;
      d.cd[k] = k * DRONE_STAGGER;
      d.age[k] = DRONE_TRACER;
    } else {
      d.x[k] += (px - d.x[k]) * follow;
      d.y[k] += (py - d.y[k]) * follow;
    }
    d.age[k] = Math.min(DRONE_TRACER, d.age[k] + dt);
    d.cd[k] = Math.max(0, d.cd[k] - dt);
    if (d.cd[k] > 0) continue;
    const t = grid.nearest(world, d.x[k], d.y[k], L.range);
    if (t < 0) continue;
    d.tx[k] = world.x[t]; // before the hit: a kill can free and refill the slot
    d.ty[k] = world.y[t];
    d.cd[k] = L.interval * player.stats.cooldownMult;
    d.age[k] = 0;
    kills += hitEnemy(game, t, dmg, HIT_CRIT | HIT_STATUS, 0, 0);
  }
  return kills;
}

export const DRONE: WeaponDef = {
  id: 'drone',
  name: 'Hornets',
  desc: 'A buzzing swarm follows you and stings the nearest enemy in reach',
  maxLevel: DRONE_LEVELS.length,
  update: updateDrone,
};
