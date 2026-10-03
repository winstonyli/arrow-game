// Presentation-only effects: hit flash, particles, screen shake, damage vignette. The sim never reads
// this; it only calls kill/burst/shake from hooks. main.js calls observe(game) then update(frameDt) once
// per frame; the renderers read the state.
import { KIND } from '../core/world.js';
import { bladePos, MAX_BLADES } from '../game/orbit.js';
import { TRAIL_N, TRAIL_DT } from './trail.js';

export const FLASH_TIME = 0.08; // seconds an enemy stays white after a hit
export const POOL = 512;
export const DOT = 0;
export const RING = 1;
export const PAL_GEM = -1; // particle palette: an enemy type index, or this for gem gold
const TAU = Math.PI * 2;

export function createFx(capacity, rng = Math.random) {
  const lastHp = new Float32Array(capacity);
  const lastGen = new Int32Array(capacity).fill(-1); // -1: slot not seen yet (gen starts at 0)
  const flashUntil = new Float32Array(capacity);
  const p = {
    x: new Float32Array(POOL),
    y: new Float32Array(POOL),
    vx: new Float32Array(POOL),
    vy: new Float32Array(POOL),
    r: new Float32Array(POOL),
    dr: new Float32Array(POOL), // radius growth per second (negative shrinks)
    life: new Float32Array(POOL),
    max: new Float32Array(POOL),
    shape: new Uint8Array(POOL),
    pal: new Int16Array(POOL),
  };
  // Gems have no velocity in the sim (the magnet moves them directly), so it is derived per sim tick.
  const gvx = new Float32Array(capacity);
  const gvy = new Float32Array(capacity);
  const gpx = new Float32Array(capacity);
  const gpy = new Float32Array(capacity);
  let simTime = 0;
  // Position history of the player (track 0) and each orbit blade (track 1 + k): a ring of TRAIL_N samples.
  const TRACKS = 1 + MAX_BLADES;
  const trail = { x: new Float32Array(TRACKS * TRAIL_N), y: new Float32Array(TRACKS * TRAIL_N), count: new Uint8Array(TRACKS), head: new Uint8Array(TRACKS) };
  let lastSample = -Infinity;
  const bp = { x: 0, y: 0 };

  function record(t, x, y) {
    const h = (trail.head[t] + 1) % TRAIL_N;
    trail.head[t] = h;
    trail.x[t * TRAIL_N + h] = x;
    trail.y[t * TRAIL_N + h] = y;
    if (trail.count[t] < TRAIL_N) trail.count[t]++;
  }

  let next = 0;
  let lastPlayerHp = null;

  function emit(x, y, vx, vy, r, dr, life, shape, pal) {
    const k = next;
    next = (next + 1) % POOL;
    p.x[k] = x;
    p.y[k] = y;
    p.vx[k] = vx;
    p.vy[k] = vy;
    p.r[k] = r;
    p.dr[k] = dr;
    p.life[k] = p.max[k] = life;
    p.shape[k] = shape;
    p.pal[k] = pal;
  }

  function dots(x, y, n, speed, spread, r, life, pal) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rng() * 0.6;
      const s = speed + rng() * spread;
      emit(x, y, Math.cos(a) * s, Math.sin(a) * s, r, (-r * 0.5) / life, life, DOT, pal);
    }
  }

  const fx = {
    p,
    clock: 0,
    trauma: 0,
    sx: 0, // current shake offset in px
    sy: 0,
    hurt: 0, // damage vignette strength, 1 right after a hit

    gvx,
    gvy,
    trail,

    flashing: (i) => flashUntil[i] > fx.clock,

    // Sample `age` steps back (0 = newest) of history track `t`; false if there is no such sample yet.
    sample(t, age, out) {
      if (age >= trail.count[t]) return false;
      const k = t * TRAIL_N + ((trail.head[t] - age + TRAIL_N) % TRAIL_N);
      out.x = trail.x[k];
      out.y = trail.y[k];
      return true;
    },

    kill(x, y, r, pal) {
      emit(x, y, 0, 0, r, 70, 0.3, RING, pal);
      dots(x, y, 5, 80, 60, 2.5, 0.35, pal);
    },

    burst(x, y) {
      dots(x, y, 5, 50, 50, 2, 0.4, PAL_GEM);
    },

    shake(a) {
      fx.trauma = Math.min(1, fx.trauma + a);
    },

    // Derives flashes and the hurt vignette from sim state. hp only ever falls on a hit, so a drop is a hit.
    observe(game) {
      const { world, player } = game;
      const dtSim = game.time - simTime;
      if (dtSim > 0) simTime = game.time;
      for (let i = 0; i < world.high; i++) {
        const kind = world.kind[i];
        if (kind === KIND.GEM) {
          if (world.gen[i] !== lastGen[i]) {
            lastGen[i] = world.gen[i];
            gpx[i] = world.x[i];
            gpy[i] = world.y[i];
            gvx[i] = gvy[i] = 0;
          } else if (dtSim > 0) {
            gvx[i] = (world.x[i] - gpx[i]) / dtSim;
            gvy[i] = (world.y[i] - gpy[i]) / dtSim;
            gpx[i] = world.x[i];
            gpy[i] = world.y[i];
          }
          continue;
        }
        if (kind !== KIND.ENEMY) continue;
        if (world.gen[i] !== lastGen[i]) {
          lastGen[i] = world.gen[i]; // a new occupant of this slot
          lastHp[i] = world.hp[i];
          flashUntil[i] = 0;
          continue;
        }
        if (world.hp[i] < lastHp[i]) flashUntil[i] = fx.clock + FLASH_TIME;
        lastHp[i] = world.hp[i];
      }
      if (lastPlayerHp !== null && player.hp < lastPlayerHp) {
        fx.hurt = 1;
        fx.shake(0.35);
      }
      lastPlayerHp = player.hp;
      if (fx.clock - lastSample >= TRAIL_DT - 1e-6) { // epsilon: summed frame dts land a hair under TRAIL_DT
        lastSample = fx.clock;
        record(0, player.x, player.y);
        const orbit = player.stats.orbit;
        for (let k = 0; k < MAX_BLADES; k++) {
          if (k >= orbit) {
            trail.count[1 + k] = 0;
            continue;
          }
          bladePos(player, game.time, k, bp);
          record(1 + k, bp.x, bp.y);
        }
      }
    },

    update(dt) {
      fx.clock += dt;
      const drag = Math.max(0, 1 - 5 * dt);
      for (let k = 0; k < POOL; k++) {
        if (p.life[k] <= 0) continue;
        p.life[k] -= dt;
        p.x[k] += p.vx[k] * dt;
        p.y[k] += p.vy[k] * dt;
        p.vx[k] *= drag;
        p.vy[k] *= drag;
        p.r[k] += p.dr[k] * dt;
      }
      fx.trauma = Math.max(0, fx.trauma - 1.5 * dt);
      const amp = fx.trauma * fx.trauma * 10;
      fx.sx = amp ? (rng() * 2 - 1) * amp : 0;
      fx.sy = amp ? (rng() * 2 - 1) * amp : 0;
      fx.hurt = Math.max(0, fx.hurt - 2.5 * dt);
    },

    // Red vignette strength in [0, 1]: a decaying flash after a hit, or a slow pulse below 30% hp.
    vignette(player) {
      const low = player.hp > 0 && player.hp < player.maxHp * 0.3 ? 0.25 + 0.1 * Math.sin(fx.clock * 6) : 0;
      return Math.max(fx.hurt * 0.6, low);
    },
  };
  return fx;
}
