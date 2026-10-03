// @ts-check
import { createPlayback } from './playback.js';

const POS_EVERY = 6; // ticks between stored positions (10 Hz); the renderer interpolates
const STAT_EVERY = 60; // ticks between stored level / kills / room (1 Hz)

/**
 * Simulates a stored replay once into a track of positions and stats, in slices so it never stalls a frame.
 * The track fills far faster than live play advances, so the ghost is always ready by the time it is needed.
 */
export function createGhostBuilder(/** @type {import('./codec.js').Replay} */ replay) {
  const pb = createPlayback(replay);
  const g = pb.game;
  const np = Math.floor(replay.ticks / POS_EVERY) + 1;
  const ns = Math.floor(replay.ticks / STAT_EVERY) + 1;
  const track = {
    total: replay.ticks,
    ready: 0, // ticks simulated so far
    xy: new Float32Array(np * 2),
    level: new Uint16Array(ns),
    kills: new Uint32Array(ns),
    room: new Uint16Array(ns),
    end: { x: 0, y: 0, level: 1, kills: 0, room: 0 },
  };
  let done = false;
  const sample = () => {
    const t = g.ticks;
    if (t % POS_EVERY === 0) {
      track.xy[(t / POS_EVERY) * 2] = g.player.x;
      track.xy[(t / POS_EVERY) * 2 + 1] = g.player.y;
    }
    if (t % STAT_EVERY === 0) {
      track.level[t / STAT_EVERY] = g.level;
      track.kills[t / STAT_EVERY] = g.kills;
      track.room[t / STAT_EVERY] = g.mode.room ?? 0;
    }
    if (t === track.total) track.end = { x: g.player.x, y: g.player.y, level: g.level, kills: g.kills, room: g.mode.room ?? 0 };
    track.ready = t;
  };
  sample();
  return {
    track,
    /** Simulates for about `budgetMs` (always at least one tick). Returns true once the whole track exists. */
    work(/** @type {number} */ budgetMs) {
      const t0 = performance.now();
      while (!done) {
        if (!pb.step()) {
          done = true;
          break;
        }
        sample();
        if (performance.now() - t0 >= budgetMs) break;
      }
      return done;
    },
  };
}

/**
 * The ghost at live tick `tick`, written into `out`. Returns null while the track has not reached that tick.
 * At or after the replay's last tick the ghost is out (`alive: false`) and `fade` counts seconds since.
 */
export function ghostAt(/** @type {ReturnType<typeof createGhostBuilder>['track']} */ track, /** @type {number} */ tick, out = /** @type {any} */ ({})) {
  // Past the end the ghost is parked, so any tick is answerable once the whole track exists.
  if (tick > track.ready && track.ready < track.total) return null;
  if (tick >= track.total) {
    const e = track.end;
    Object.assign(out, { x: e.x, y: e.y, alive: false, fade: (tick - track.total) / 60, level: e.level, kills: e.kills, room: e.room });
    return out;
  }
  const f = tick / POS_EVERY;
  const a = Math.floor(f);
  const b = (a + 1) * POS_EVERY <= track.ready ? a + 1 : a;
  const k = b === a ? 0 : f - a;
  const s = Math.min(Math.floor(tick / STAT_EVERY), Math.floor(track.ready / STAT_EVERY));
  out.x = track.xy[a * 2] + (track.xy[b * 2] - track.xy[a * 2]) * k;
  out.y = track.xy[a * 2 + 1] + (track.xy[b * 2 + 1] - track.xy[a * 2 + 1]) * k;
  out.alive = true;
  out.fade = 0;
  out.level = track.level[s];
  out.kills = track.kills[s];
  out.room = track.room[s];
  return out;
}
