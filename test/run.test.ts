import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun } from '../src/game/run.ts';
import { tick } from '../src/game/game.ts';
import { stateHash } from '../src/replay/hash.ts';
import { ARENA_BOUNDS } from '../src/modes/arena.ts';
import type { Game } from '../src/game/game.ts';

const spin = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) tick(g, 1 / 60);
  return stateHash(g);
};

test('newRun with the same seed gives the same state; a different seed diverges', () => {
  const mk = (seed: number) => newRun({ mode: 'rooms', seed, input: { x: 0, y: 0 } });
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
