import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, better } from '../src/replay/store.ts';
import { fakeReplay } from '../scripts/lib/fake-replay.ts';
import { SIM_VERSION } from '../src/replay/version.ts';
import type { StorageLike } from '../src/replay/store.ts';
import type { ReplayResult } from '../src/replay/codec.ts';

// A Web Storage stand-in; `quota` limits the total characters stored.
function memory(quota = Infinity) {
  const m = new Map<string, string>();
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem(k: string, v: string) {
      const prev = m.get(k);
      m.set(k, String(v));
      if (size() > quota) {
        prev === undefined ? m.delete(k) : m.set(k, prev);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k: string) => m.delete(k),
  };
}
const arena = (seed: number, time: number, kills = 0, extra = {}) => fakeReplay({ mode: 'arena', seed, result: { time, kills }, savedAt: seed, ...extra });
const rooms = (seed: number, room: number, time = 10) => fakeReplay({ mode: 'rooms', seed, result: { room, time }, savedAt: seed });

// Cast: better reads only the fields its mode ranks by, so these cases pass partial results.
const rank = better as (mode: string, a: Partial<ReplayResult>, b: Partial<ReplayResult>) => boolean;

test('better ranks arena by time then kills, rooms by room then time', () => {
  assert.ok(rank('arena', { time: 10, kills: 0 }, { time: 9, kills: 99 }));
  assert.ok(rank('arena', { time: 10, kills: 5 }, { time: 10, kills: 4 }));
  assert.ok(!rank('arena', { time: 10, kills: 4 }, { time: 10, kills: 4 }));
  assert.ok(rank('rooms', { room: 4, time: 1 }, { room: 3, time: 99 }));
  assert.ok(rank('rooms', { room: 4, time: 9 }, { room: 4, time: 8 }));
});

test('submit keeps only the best per (mode, seed)', () => {
  const s = createStore(memory());
  assert.deepEqual(s.submit(arena(1, 30), 'Daily'), { saved: true, isBest: true });
  assert.deepEqual(s.submit(arena(1, 20)), { saved: false, isBest: false });
  assert.deepEqual(s.submit(arena(1, 40)), { saved: true, isBest: true });
  assert.equal(s.list().length, 1);
  assert.equal(s.get('arena', 1)!.result.time, 40);
  assert.equal(s.list()[0].label, ''); // the better run replaced the entry, label included
});

test('the same seed in the other mode is a separate entry', () => {
  const s = createStore(memory());
  s.submit(arena(1, 30));
  s.submit(rooms(1, 3));
  assert.equal(s.list().length, 2);
});

test('list is newest first and flags stale entries; stale entries cannot be fetched', () => {
  const s = createStore(memory());
  s.submit(arena(1, 30, 0, { sim: SIM_VERSION - 1 }));
  s.submit(arena(2, 30));
  const l = s.list();
  assert.deepEqual(l.map((e) => [e.seed, e.stale]), [[2, false], [1, true]]);
  assert.equal(s.get('arena', 1), null);
  assert.ok(s.get('arena', 2));
});

test('a new run replaces a stale entry even when it is worse', () => {
  const s = createStore(memory());
  s.submit(arena(1, 99, 0, { sim: SIM_VERSION - 1 }));
  assert.deepEqual(s.submit(arena(1, 5)), { saved: true, isBest: true });
  assert.equal(s.list()[0].stale, false);
});

test('the cap drops the oldest replay and its stored data', () => {
  const st = memory();
  const s = createStore(st, { cap: 3 });
  for (const seed of [1, 2, 3, 4]) s.submit(arena(seed, 10));
  assert.deepEqual(s.list().map((e) => e.seed), [4, 3, 2]);
  assert.equal(st.getItem('arrow-replay-arena-1'), null);
});

test('on a full store it drops the oldest and retries once', () => {
  const one = JSON.stringify(arena(1, 10)).length;
  const st = memory(one * 2 + 600); // room for about two replays plus the index
  const s = createStore(st);
  for (const seed of [1, 2, 3, 4]) s.submit(arena(seed, 10));
  const seeds = s.list().map((e) => e.seed);
  assert.equal(seeds[0], 4);
  assert.ok(!seeds.includes(1));
  assert.ok(s.get('arena', 4));
});

test('remove deletes the entry and the data', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10));
  s.remove('arena', 1);
  assert.deepEqual(s.list(), []);
  assert.equal(st.getItem('arrow-replay-arena-1'), null);
});

test('missing, throwing and corrupt storage never throw', () => {
  for (const st of [null, undefined, { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } }]) {
    const s = createStore(st as StorageLike | null); // cast: `undefined` (no storage at all) is passed on purpose
    assert.deepEqual(s.list(), []);
    assert.equal(s.get('arena', 1), null);
    assert.equal(s.submit(arena(1, 10)).saved, false);
    s.remove('arena', 1);
  }
  const bad = memory();
  bad.m.set('arrow-replay-index', '{"not":"an array"}');
  assert.deepEqual(createStore(bad).list(), []);
  bad.m.set('arrow-replay-index', JSON.stringify([{ mode: 'arena', seed: 1, time: 'x' }]));
  assert.deepEqual(createStore(bad).list(), []);
});

test('get returns null when the stored replay is corrupt', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10));
  st.m.set('arrow-replay-arena-1', '{"v":1');
  assert.equal(s.get('arena', 1), null);
});

// Invariant: every listed entry has data (unless stale) and every data key is listed.
function consistent(st: ReturnType<typeof memory>, s: ReturnType<typeof createStore>) {
  const listed = new Set(s.list().map((e) => `arrow-replay-${e.mode}-${e.seed}`));
  for (const e of s.list()) if (!e.stale) assert.ok(s.get(e.mode, e.seed), `entry ${e.seed} has no data`);
  for (const k of st.m.keys()) if (k !== 'arrow-replay-index') assert.ok(listed.has(k), `orphan data ${k}`);
}

test('a failed retry rolls back to a consistent store', () => {
  const one = JSON.stringify(arena(1, 10)).length;
  for (const quota of [one + 60, one + 150, one * 2 + 250, one * 2 + 350]) {
    const st = memory(quota);
    const s = createStore(st);
    for (const seed of [1, 2, 3, 4]) {
      s.submit(arena(seed, 10));
      consistent(st, s);
    }
    // improving an existing entry may also fail mid-way
    s.submit(arena(4, 50));
    consistent(st, s);
  }
});

test('a failed improvement keeps the previous best', () => {
  const st = memory(400);
  const s = createStore(st);
  s.submit(arena(1, 10));
  const r = s.submit(arena(1, 20, 0, { savedAt: 99 }));
  consistent(st, s);
  if (!r.saved) assert.equal(s.get('arena', 1)!.result.time, 10);
});

test('when every write of the improvement fails, the previous best is restored and listed', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10), 'Daily');
  const before = s.get('arena', 1);
  const realSet = st.setItem;
  st.setItem = (k, v) => {
    if (String(v).includes('"time":20')) throw new Error('QuotaExceededError'); // the new replay never fits
    return realSet(k, v);
  };
  assert.deepEqual(s.submit(arena(1, 20, 0, { savedAt: 99 })), { saved: false, isBest: false });
  consistent(st, s);
  assert.deepEqual(s.get('arena', 1), before);
  assert.equal(s.list().find((e) => e.seed === 1)!.label, 'Daily');
});

test('when the previous best cannot be rewritten either, nothing dangles', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10));
  const realSet = st.setItem;
  st.setItem = (k, v) => {
    if (k === 'arrow-replay-arena-1') throw new Error('QuotaExceededError'); // no data write succeeds
    return realSet(k, v);
  };
  assert.equal(s.submit(arena(1, 20, 0, { savedAt: 99 })).saved, false);
  consistent(st, s);
});

test('a cap of 0 or less never drops the just-saved entry', () => {
  for (const cap of [0, -3]) {
    const s = createStore(memory(), { cap });
    assert.equal(s.submit(arena(1, 10)).saved, true);
    assert.equal(s.submit(arena(2, 10)).saved, true);
    assert.deepEqual(s.list().map((e) => e.seed), [2]);
    assert.ok(s.get('arena', 2));
  }
});

test('with equal savedAt the older (later in the list) entry is dropped first', () => {
  const st = memory();
  const s = createStore(st, { cap: 2 });
  for (const seed of [1, 2, 3]) s.submit(arena(seed, 10, 0, { savedAt: 7 }));
  assert.deepEqual(s.list().map((e) => e.seed), [3, 2]);
});

test('remove leaves the index alone when it cannot be read', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10));
  const before = st.m.get('arrow-replay-index');
  const real = st.getItem;
  let armed = true;
  st.getItem = (k) => {
    if (armed && k === 'arrow-replay-index') { armed = false; throw new Error('flaky'); }
    return real(k);
  };
  s.remove('arena', 1);
  assert.equal(st.m.get('arrow-replay-index'), before);
  assert.ok(s.get('arena', 1));
});

test('get rejects a blob whose own sim differs from the index entry', () => {
  const st = memory();
  const s = createStore(st);
  s.submit(arena(1, 10));
  st.m.set('arrow-replay-arena-1', JSON.stringify(arena(1, 10, 0, { sim: SIM_VERSION - 1 })));
  assert.equal(s.get('arena', 1), null);
});

test('cap eviction drops random-seed (unlabelled) runs before labelled ones, even when older', () => {
  const s = createStore(memory(), { cap: 3 });
  s.submit(arena(1, 10), 'Daily Arena'); // oldest, labelled
  s.submit(arena(2, 10)); // random
  s.submit(arena(3, 10), 'hello'); // custom
  s.submit(arena(4, 10)); // random: evicts seed 2, not the older labelled seed 1
  assert.deepEqual(s.list().map((e) => e.seed).sort(), [1, 3, 4]);
  s.submit(arena(5, 10)); // evicts the older random (4)
  assert.deepEqual(s.list().map((e) => e.seed).sort(), [1, 3, 5]);
});

test('with only labelled entries the oldest labelled one is evicted', () => {
  const s = createStore(memory(), { cap: 2 });
  s.submit(arena(1, 10), 'a');
  s.submit(arena(2, 10), 'b');
  s.submit(arena(3, 10), 'c');
  assert.deepEqual(s.list().map((e) => e.seed).sort(), [2, 3]);
});

test('a new labelled run is kept when only random runs fill the store', () => {
  const s = createStore(memory(), { cap: 2 });
  s.submit(arena(1, 10));
  s.submit(arena(2, 10));
  s.submit(arena(3, 10), 'Daily');
  assert.deepEqual(s.list().map((e) => e.seed).sort(), [2, 3]);
});
