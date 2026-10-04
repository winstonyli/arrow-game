// Persisted personal bests per mode. `storage` is injected (localStorage, a stub, or null) and every access is
// guarded: storage can be missing or throw (private windows, blocked site data).
import type { ModeName } from './game.ts';

export type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type Bests = Record<string, number>; // field ("time", "kills", "room") -> best value

const key = (kind: ModeName) => `arrow-best-${kind}`;

export function loadBest(storage: RecordStorage | null | undefined, kind: ModeName): Bests {
  try {
    const v = JSON.parse(storage?.getItem(key(kind)) ?? 'null') as Bests | null; // untrusted: checked just below
    if (!v || typeof v !== 'object') return {};
    for (const k of Object.keys(v)) if (!Number.isFinite(v[k])) delete v[k]; // stored values are untrusted
    return v;
  } catch {
    return {};
  }
}

// result: { time, kills } for arena, { room } for rooms. A field is "new" when it beats the stored value.
// A field may be undefined (Mode.room is optional in the types): like NaN, it is never new and never stored.
export function submit(
  storage: RecordStorage | null | undefined,
  kind: ModeName,
  result: Record<string, number | undefined>,
): { best: Bests; isNew: Record<string, boolean> } {
  const best = { ...loadBest(storage, kind) };
  const isNew: Record<string, boolean> = {};
  for (const [field, v] of Object.entries(result)) {
    const beats = v !== undefined && Number.isFinite(v) && v > (best[field] ?? 0); // `v !== undefined` only narrows: Number.isFinite(undefined) is false
    isNew[field] = beats;
    if (beats) best[field] = v;
  }
  try {
    storage?.setItem(key(kind), JSON.stringify(best));
  } catch {}
  return { best, isNew };
}
