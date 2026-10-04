import { SIM_VERSION } from './version.js';
import { validate } from './codec.js';

export const CAP = 40;
const INDEX = 'arrow-replay-index';
const keyOf = (/** @type {string} */ mode, /** @type {number} */ seed) => `arrow-replay-${mode}-${seed}`;

/** Does result `a` beat result `b`? Arena: longest survival, then kills. Rooms: highest room, then time. */
export const better = (/** @type {string} */ mode, /** @type {any} */ a, /** @type {any} */ b) =>
  mode === 'rooms' ? a.room > b.room || (a.room === b.room && a.time > b.time) : a.time > b.time || (a.time === b.time && a.kills > b.kills);

const isEntry = (/** @type {any} */ e) =>
  e && (e.mode === 'arena' || e.mode === 'rooms') && Number.isInteger(e.seed) && e.seed >= 0 && e.seed <= 0xffffffff &&
  ['time', 'kills', 'level', 'room', 'savedAt', 'sim'].every((k) => Number.isFinite(e[k])) && typeof e.label === 'string';

const summary = (/** @type {any} */ r, /** @type {string} */ label) => ({
  mode: r.mode, seed: r.seed, label: String(label).slice(0, 40),
  time: r.result.time, kills: r.result.kills, level: r.result.level, room: r.result.room, savedAt: r.savedAt, sim: r.sim,
});

/**
 * Best replay per (mode, seed) on top of a Web Storage-shaped `storage` ({getItem, setItem, removeItem}, may be null).
 * Every access is guarded: storage can be missing, full or throw.
 */
export function createStore(/** @type {any} */ storage, { cap = CAP } = {}) {
  cap = Math.max(1, cap);
  /** The valid index entries, or null when the index cannot be read (distinct from empty). */
  const tryIndex = () => {
    try {
      const v = JSON.parse(storage?.getItem(INDEX) ?? '[]');
      return Array.isArray(v) ? v.filter(isEntry) : null;
    } catch {
      return null;
    }
  };
  const readIndex = () => tryIndex() ?? [];
  /** Eviction victim: the oldest unlabelled (random-seed) entry, else the oldest overall, so daily and custom-seed bests outlive random runs. */
  const oldestOf = (/** @type {any[]} */ list, /** @type {any} */ except) => {
    const rest = list.filter((e) => e !== except);
    const pool = rest.some((e) => !e.label) ? rest.filter((e) => !e.label) : rest;
    return pool.reduce((a, e) => (a && a.savedAt < e.savedAt ? a : e), null);
  };
  const drop = (/** @type {any} */ e) => {
    try {
      storage.removeItem(keyOf(e.mode, e.seed));
    } catch {}
  };

  return {
    list() {
      return readIndex().map((e) => ({ ...e, stale: e.sim !== SIM_VERSION }));
    },
    get(/** @type {string} */ mode, /** @type {number} */ seed) {
      try {
        const e = readIndex().find((x) => x.mode === mode && x.seed === seed);
        if (!e || e.sim !== SIM_VERSION) return null;
        const r = validate(JSON.parse(storage.getItem(keyOf(mode, seed))));
        return r.sim === SIM_VERSION ? r : null;
      } catch {
        return null;
      }
    },
    submit(/** @type {any} */ replay, label = '') {
      const none = { saved: false, isBest: false };
      try {
        validate(replay);
        const idx = readIndex();
        const old = idx.find((e) => e.mode === replay.mode && e.seed === replay.seed);
        if (old && old.sim === SIM_VERSION && !better(replay.mode, replay.result, old)) return none;
        const entry = summary(replay, label);
        const next = [entry, ...idx.filter((e) => e !== old)];
        /** Entries whose data we have already removed: they must leave the index too. */
        const gone = [];
        const free = (/** @type {any} */ e) => {
          drop(e);
          gone.push(e);
        };
        while (next.length > cap) free(next.splice(next.indexOf(oldestOf(next, entry)), 1)[0]);
        let oldBlob = null; // the previous best's data, so a failed improvement can put it back
        if (old) {
          try {
            oldBlob = storage.getItem(keyOf(replay.mode, replay.seed));
          } catch {}
        }
        const put = () => {
          storage.setItem(keyOf(replay.mode, replay.seed), JSON.stringify(replay));
          storage.setItem(INDEX, JSON.stringify(next));
        };
        try {
          put();
        } catch (e) {
          try {
            const victim = oldestOf(next, entry);
            if (!victim) throw e;
            next.splice(next.indexOf(victim), 1);
            free(victim); // free its data before retrying
            put();
          } catch {
            // Roll back to a consistent state: no data without an index entry, no entry without data. The previous best comes back if its data can be rewritten.
            drop(entry);
            let restored = false;
            if (old && oldBlob != null) {
              try {
                storage.setItem(keyOf(replay.mode, replay.seed), oldBlob);
                restored = true;
              } catch {}
            }
            const keep = idx.filter((x) => (x !== old || restored) && !gone.includes(x));
            try {
              storage.setItem(INDEX, JSON.stringify(keep));
            } catch {}
            return none;
          }
        }
        return { saved: true, isBest: true };
      } catch {
        return none;
      }
    },
    remove(/** @type {string} */ mode, /** @type {number} */ seed) {
      try {
        const idx = tryIndex();
        if (!idx) return;
        storage.setItem(INDEX, JSON.stringify(idx.filter((e) => !(e.mode === mode && e.seed === seed))));
        storage.removeItem(keyOf(mode, seed));
      } catch {}
    },
  };
}
