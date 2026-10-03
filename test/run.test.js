import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '../src/game/run.js';
import { tick } from '../src/game/game.js';
import { stateHash } from '../src/replay/hash.js';
import { ARENA_BOUNDS } from '../src/modes/arena.js';

const spin = (g, n) => {
  for (let i = 0; i < n; i++) tick(g, 1 / 60);
  return stateHash(g);
};

test('newRun with the same seed gives the same state; a different seed diverges', () => {
  const mk = (seed) => newRun({ mode: 'rooms', seed, input: { x: 0, y: 0 } });
  assert.equal(spin(mk(5), 120), spin(mk(5), 120));
  assert.notEqual(spin(mk(5), 120), spin(mk(6), 120));
});

test('newRun picks the mode and its bounds', () => {
  const a = newRun({ mode: 'arena', seed: 1, input: { x: 0, y: 0 } });
  assert.deepEqual(a.bounds, ARENA_BOUNDS);
  assert.equal(a.mode.bossEvery, undefined);
  const r = newRun({ mode: 'rooms', seed: 1, input: { x: 0, y: 0 } });
  assert.equal(r.bounds.w, 900);
  assert.equal(r.mode.bossEvery, 10);
});
