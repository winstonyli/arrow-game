import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBest, submit } from '../src/game/records.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('first result is a new best and is stored', () => {
  const s = mem();
  const r = submit(s, 'arena', { time: 90, kills: 40 });
  assert.deepEqual(r.isNew, { time: true, kills: true });
  assert.deepEqual(loadBest(s, 'arena'), { time: 90, kills: 40 });
});

test('fields are tracked separately; worse results keep the best', () => {
  const s = mem();
  submit(s, 'arena', { time: 90, kills: 40 });
  const r = submit(s, 'arena', { time: 60, kills: 55 });
  assert.deepEqual(r.isNew, { time: false, kills: true });
  assert.deepEqual(r.best, { time: 90, kills: 55 });
});

test('modes do not share bests', () => {
  const s = mem();
  submit(s, 'arena', { time: 90, kills: 40 });
  assert.deepEqual(loadBest(s, 'rooms'), {});
});

test('bad JSON, throwing and null storage never throw', () => {
  const bad = { getItem: () => '{nope', setItem() {} };
  assert.deepEqual(loadBest(bad, 'arena'), {});
  const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadBest(boom, 'rooms'), {});
  assert.deepEqual(submit(boom, 'rooms', { room: 3 }).isNew, { room: true });
  assert.deepEqual(submit(null, 'rooms', { room: 3 }).best, { room: 3 });
});

test('non-finite results are never a best', () => {
  assert.deepEqual(submit(mem(), 'rooms', { room: NaN }).isNew, { room: false });
});
