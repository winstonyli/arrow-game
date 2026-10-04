// Presentation-only effects: hit flash, particles, screen shake, damage vignette. The sim never reads
// this; it only calls kill/burst/shake from hooks. main.ts calls observe(game) then update(frameDt) once
// per frame; the renderers read the state.
import { KIND } from '../core/world.ts';
import { bladePos, MAX_BLADES } from '../game/orbit.ts';
import { TRAIL_N, TRAIL_MID, TRAIL_END, bentTail } from './trail.ts';
import type { Tail } from './trail.ts';
import type { World } from '../core/world.ts';
import type { Game } from '../game/game.ts';
import type { Player } from '../game/player.ts';

export const FLASH_TIME = 0.08; // seconds an enemy stays white after a hit
export const POOL = 512;
export const DOT = 0;
export const RING = 1;
// Particle palette: an enemy type index (>= 0), or one of the negative ids below.
export const PAL_GEM = -1; // gem gold
export const PAL_WHITE = -2; // crit ring and sparks: white
export const PAL_DUST = -3; // knockback dust: grey (the cue palette is distinct from kill rings, which use enemy colours or gold)
const TAU = Math.PI * 2;

export type Fx = ReturnType<typeof createFx>;

export function createFx(capacity: number, rng: () => number = Math.random) {
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
  // Position history of every enemy, arrow and gem slot: TRAIL_N sampled positions, ring-indexed by `head`
  // (shared, since all slots are sampled together). histGen/born say which occupant a slot's history belongs to.
  const histX = new Float32Array(TRAIL_N * capacity);
  const histY = new Float32Array(TRAIL_N * capacity);
  const histGen = new Int32Array(capacity).fill(-1);
  const born = new Int32Array(capacity); // sample number of the slot's first sample
  let seq = 0; // number of samples taken so far
  // Position history of the player (track 0) and each orbit blade (track 1 + k): a ring of TRAIL_N samples, turned into the same bent tail as the slots'.
  const TRACKS = 1 + MAX_BLADES;
  const trail = { x: new Float32Array(TRACKS * TRAIL_N), y: new Float32Array(TRACKS * TRAIL_N), count: new Uint8Array(TRACKS), head: new Uint8Array(TRACKS) };
  const bp = { x: 0, y: 0 };

  function record(t: number, x: number, y: number): void {
    const h = (trail.head[t] + 1) % TRAIL_N;
    trail.head[t] = h;
    trail.x[t * TRAIL_N + h] = x;
    trail.y[t * TRAIL_N + h] = y;
    if (trail.count[t] < TRAIL_N) trail.count[t]++;
  }

  function sampleMovers(world: World): void {
    seq++;
    const h = seq % TRAIL_N;
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] === KIND.NONE) continue;
      if (histGen[i] !== world.gen[i]) {
        histGen[i] = world.gen[i];
        born[i] = seq;
      }
      histX[h * capacity + i] = world.x[i];
      histY[h * capacity + i] = world.y[i];
    }
  }

  let next = 0;
  let lastPlayerHp: number | null = null;

  function emit(x: number, y: number, vx: number, vy: number, r: number, dr: number, life: number, shape: number, pal: number): void {
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

  function dots(x: number, y: number, n: number, speed: number, spread: number, r: number, life: number, pal: number): void {
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

    hits: 0, // running count of enemy hp drops seen by observe (the audio reads it)
    trail,

    flashing: (i: number): boolean => flashUntil[i] > fx.clock,

    // An hp drop of `dmg` on slot j that is continuous damage, not a hit: forget it so observe sees no drop.
    soft(j: number, dmg: number): void {
      lastHp[j] -= dmg;
    },

    // Writes slot i's tail (see bentTail) to `out`; zero until it has two samples, and for a slot whose
    // current occupant has none yet, so a recycled slot never inherits a ghost.
    tail(world: World, i: number, out: Tail): void {
      const avail = histGen[i] === world.gen[i] ? seq - born[i] : 0;
      if (avail < 1) {
        out.mx = out.my = out.ex = out.ey = 0;
        return;
      }
      const e = (seq - Math.min(TRAIL_END, avail) + TRAIL_N * 2) % TRAIL_N * capacity + i;
      const ex = histX[e] - world.x[i];
      const ey = histY[e] - world.y[i];
      if (avail > TRAIL_MID) {
        const m = (seq - TRAIL_MID + TRAIL_N * 2) % TRAIL_N * capacity + i;
        bentTail(histX[m] - world.x[i], histY[m] - world.y[i], ex, ey, out, world.radius[i]);
      } else {
        bentTail(ex / 2, ey / 2, ex, ey, out, world.radius[i]); // too young for a bend: a straight tail
      }
    },

    // Same as tail() for the player (track 0) or blade k (track 1 + k), which are not slots: x, y is its current
    // centre and r its radius.
    trackTail(t: number, x: number, y: number, r: number, out: Tail): void {
      const avail = trail.count[t] - 1;
      if (avail < 1) {
        out.mx = out.my = out.ex = out.ey = 0;
        return;
      }
      const e = t * TRAIL_N + ((trail.head[t] - Math.min(TRAIL_END, avail) + TRAIL_N) % TRAIL_N);
      const ex = trail.x[e] - x;
      const ey = trail.y[e] - y;
      if (avail > TRAIL_MID) {
        const m = t * TRAIL_N + ((trail.head[t] - TRAIL_MID + TRAIL_N) % TRAIL_N);
        bentTail(trail.x[m] - x, trail.y[m] - y, ex, ey, out, r);
      } else {
        bentTail(ex / 2, ey / 2, ex, ey, out, r);
      }
    },

    kill(x: number, y: number, r: number, pal: number): void {
      emit(x, y, 0, 0, r, 70, 0.3, RING, pal);
      dots(x, y, 5, 80, 60, 2.5, 0.35, pal);
    },

    burst(x: number, y: number): void {
      dots(x, y, 5, 50, 50, 2, 0.4, PAL_GEM);
    },

    // A landed crit: a ring and fast white sparks, white, unlike kill rings.
    crit(x: number, y: number): void {
      emit(x, y, 0, 0, 6, 90, 0.2, RING, PAL_WHITE);
      dots(x, y, 6, 110, 60, 2, 0.25, PAL_WHITE);
    },

    // A knockback: a few grey dust dots left at the old position, drifting back against the push.
    push(x: number, y: number, dx: number, dy: number): void {
      const m = Math.hypot(dx, dy);
      if (m < 1e-6) return;
      const ux = -dx / m;
      const uy = -dy / m;
      for (let k = 0; k < 3; k++) {
        const s = 30 + rng() * 30;
        emit(x, y, ux * s - uy * (rng() - 0.5) * 30, uy * s + ux * (rng() - 0.5) * 30, 2.5, -2.5 / 0.3, 0.3, DOT, PAL_DUST);
      }
    },

    shake(a: number): void {
      fx.trauma = Math.min(1, fx.trauma + a);
    },

    // Derives flashes and the hurt vignette from sim state. hp only ever falls on a hit, so a drop is a hit (except soft ticks).
    observe(game: Game): void {
      const { world, player } = game;
      for (let i = 0; i < world.high; i++) {
        const kind = world.kind[i];
        if (kind !== KIND.ENEMY) continue;
        if (world.gen[i] !== lastGen[i]) {
          lastGen[i] = world.gen[i]; // a new occupant of this slot
          lastHp[i] = world.hp[i];
          flashUntil[i] = 0;
          continue;
        }
        if (world.hp[i] < lastHp[i]) {
          flashUntil[i] = fx.clock + FLASH_TIME;
          fx.hits++;
        }
        lastHp[i] = world.hp[i];
      }
      if (lastPlayerHp !== null && player.hp < lastPlayerHp) {
        fx.hurt = 1;
        fx.shake(0.35);
      }
      lastPlayerHp = player.hp;
    },

    // Records one position sample of every mover. game.js calls it once per sim tick, so history is spaced by
    // sim time and tail length does not depend on the frame rate or on paused frames.
    sample(game: Game): void {
      const { world, player } = game;
      sampleMovers(world);
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
    },

    update(dt: number): void {
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
    vignette(player: Player): number {
      const low = player.hp > 0 && player.hp < player.maxHp * 0.3 ? 0.25 + 0.1 * Math.sin(fx.clock * 6) : 0;
      return Math.max(fx.hurt * 0.6, low);
    },
  };
  return fx;
}
