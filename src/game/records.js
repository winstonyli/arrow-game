// Persisted personal bests per mode. `storage` is injected (localStorage, a stub, or null) and every access is
// guarded: storage can be missing or throw (private windows, blocked site data).
const key = (kind) => `arrow-best-${kind}`;

export function loadBest(storage, kind) {
  try {
    const v = JSON.parse(storage?.getItem(key(kind)) ?? 'null');
    if (!v || typeof v !== 'object') return {};
    for (const k of Object.keys(v)) if (!Number.isFinite(v[k])) delete v[k]; // stored values are untrusted
    return v;
  } catch {
    return {};
  }
}

// result: { time, kills } for arena, { room } for rooms. A field is "new" when it beats the stored value.
export function submit(storage, kind, result) {
  const best = { ...loadBest(storage, kind) };
  const isNew = {};
  for (const [field, v] of Object.entries(result)) {
    isNew[field] = Number.isFinite(v) && v > (best[field] ?? 0);
    if (isNew[field]) best[field] = v;
  }
  try {
    storage?.setItem(key(kind), JSON.stringify(best));
  } catch {}
  return { best, isNew };
}
