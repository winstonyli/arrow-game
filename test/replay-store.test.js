import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, better } from '../src/replay/store.js';
import { fakeReplay } from '../scripts/lib/fake-replay.js';
import { SIM_VERSION } from '../src/replay/version.js';

// A Web Storage stand-in; `quota` limits the total characters stored.
function memory(quota = Infinity) {
  const m = new Map();
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const prev = m.get(k);
      m.set(k, String(v));
      if (size() > quota) {
        prev === undefined ? m.delete(k) : m.set(k, prev);
        throw new Error('QuotaExceededError');
      }
    },
    removeItem: (k) => m.delete(k),
  };
}
const arena = (seed, time, kills = 0, extra = {}) => fakeReplay({ mode: 'arena', seed, result: { time, kills }, savedAt: seed, ...extra });
const rooms = (seed, room, time = 10) => fakeReplay({ mode: 'rooms', seed, result: { room, time }, savedAt: seed });

test('better ranks arena by time then kills, rooms by room then time', () => {
  assert.ok(better('arena', { time: 10, kills: 0 }, { time: 9, kills: 99 }));
  assert.ok(better('arena', { time: 10, kills: 5 }, { time: 10, kills: 4 }));
  assert.ok(!better('arena', { time: 10, kills: 4 }, { time: 10, kills: 4 }));
  assert.ok(better('rooms', { room: 4, time: 1 }, { room: 3, time: 99 }));
  assert.ok(better('rooms', { room: 4, time: 9 }, { room: 4, time: 8 }));
});

test('submit keeps only the best per (mode, seed)', () => {
  const s = createStore(memory());
  assert.deepEqual(s.submit(arena(1, 30), 'Daily'), { saved: true, isBest: true });
  assert.deepEqual(s.submit(arena(1, 20)), { saved: false, isBest: false });
  assert.deepEqual(s.submit(arena(1, 40)), { saved: true, isBest: true });
  assert.equal(s.list().length, 1);
  assert.equal(s.get('arena', 1).result.time, 40);
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
    const s = createStore(st);
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
