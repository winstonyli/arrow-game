import { SIM_VERSION } from './version.ts';
import { validate, asRecord } from './codec.ts';
import type { Replay, ReplayResult, ReplayEntry } from './codec.ts';

export const CAP = 40;
const INDEX = 'arrow-replay-index';
const keyOf = (mode: string, seed: number) => `arrow-replay-${mode}-${seed}`;

/** The Web Storage methods the store uses (localStorage in the browser, a fake in tests). */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Does result `a` beat result `b`? Arena: longest survival, then kills. Rooms: highest room, then time. */
export const better = (mode: string, a: ReplayResult, b: ReplayResult): boolean =>
  mode === 'rooms' ? a.room > b.room || (a.room === b.room && a.time > b.time) : a.time > b.time || (a.time === b.time && a.kills > b.kills);

const isEntry = (v: unknown): v is ReplayEntry => {
  const e = asRecord(v);
  return !!e && (e.mode === 'arena' || e.mode === 'rooms') && typeof e.seed === 'number' && Number.isInteger(e.seed) && e.seed >= 0 && e.seed <= 0xffffffff &&
    ['time', 'kills', 'level', 'room', 'savedAt', 'sim'].every((k) => Number.isFinite(e[k])) && typeof e.label === 'string';
};

const summary = (r: Replay, label: string): ReplayEntry => ({
  mode: r.mode, seed: r.seed, label: String(label).slice(0, 40),
  time: r.result.time, kills: r.result.kills, level: r.result.level, room: r.result.room, savedAt: r.savedAt, sim: r.sim,
});

/**
 * Best replay per (mode, seed) on top of a Web Storage-shaped `storage` ({getItem, setItem, removeItem}, may be null).
 * Every access is guarded: storage can be missing, full or throw.
 */
export function createStore(storage: StorageLike | null, { cap = CAP }: { cap?: number } = {}) {
  cap = Math.max(1, cap);
  /** The storage, or a TypeError when it is missing: callers sit in try blocks and treat that like any failed access. */
  const st = (): StorageLike => {
    if (!storage) throw new TypeError('no storage');
    return storage;
  };
  /** The valid index entries, or null when the index cannot be read (distinct from empty). */
  const tryIndex = () => {
    try {
      const v: unknown = JSON.parse(storage?.getItem(INDEX) ?? '[]');
      return Array.isArray(v) ? v.filter(isEntry) : null;
    } catch {
      return null;
    }
  };
  const readIndex = () => tryIndex() ?? [];
  /** Eviction victim: the oldest unlabelled (random-seed) entry, else the oldest overall, so daily and custom-seed bests outlive random runs. */
  const oldestOf = (list: ReplayEntry[], except: ReplayEntry) => {
    const rest = list.filter((e) => e !== except);
    const pool = rest.some((e) => !e.label) ? rest.filter((e) => !e.label) : rest;
    return pool.reduce<ReplayEntry | null>((a, e) => (a && a.savedAt < e.savedAt ? a : e), null);
  };
  const drop = (e: ReplayEntry) => {
    try {
      st().removeItem(keyOf(e.mode, e.seed));
    } catch {}
  };

  return {
    list() {
      return readIndex().map((e) => ({ ...e, stale: e.sim !== SIM_VERSION }));
    },
    get(mode: string, seed: number): Replay | null {
      try {
        const e = readIndex().find((x) => x.mode === mode && x.seed === seed);
        if (!e || e.sim !== SIM_VERSION) return null;
        const r = validate(JSON.parse(st().getItem(keyOf(mode, seed)) ?? 'null')); // a missing item parses as null, exactly as before
        return r.sim === SIM_VERSION ? r : null;
      } catch {
        return null;
      }
    },
    submit(replay: Replay, label = '') {
      const none = { saved: false, isBest: false };
      try {
        validate(replay);
        const idx = readIndex();
        const old = idx.find((e) => e.mode === replay.mode && e.seed === replay.seed);
        if (old && old.sim === SIM_VERSION && !better(replay.mode, replay.result, old)) return none;
        const entry = summary(replay, label);
        const next = [entry, ...idx.filter((e) => e !== old)];
        /** Entries whose data we have already removed: they must leave the index too. */
        const gone: ReplayEntry[] = [];
        const free = (e: ReplayEntry) => {
          drop(e);
          gone.push(e);
        };
        // `!`: next.length > cap >= 1, so next holds an entry besides `entry` and oldestOf cannot return null.
        while (next.length > cap) free(next.splice(next.indexOf(oldestOf(next, entry)!), 1)[0]);
        let oldBlob: string | null = null; // the previous best's data, so a failed improvement can put it back
        if (old) {
          try {
            oldBlob = st().getItem(keyOf(replay.mode, replay.seed));
          } catch {}
        }
        const put = () => {
          st().setItem(keyOf(replay.mode, replay.seed), JSON.stringify(replay));
          st().setItem(INDEX, JSON.stringify(next));
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
                st().setItem(keyOf(replay.mode, replay.seed), oldBlob);
                restored = true;
              } catch {}
            }
            const keep = idx.filter((x) => (x !== old || restored) && !gone.includes(x));
            try {
              st().setItem(INDEX, JSON.stringify(keep));
            } catch {}
            return none;
          }
        }
        return { saved: true, isBest: true };
      } catch {
        return none;
      }
    },
    remove(mode: string, seed: number) {
      try {
        const idx = tryIndex();
        if (!idx) return;
        st().setItem(INDEX, JSON.stringify(idx.filter((e) => !(e.mode === mode && e.seed === seed))));
        st().removeItem(keyOf(mode, seed));
      } catch {}
    },
  };
}
