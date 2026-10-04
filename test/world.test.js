import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';

test('spawn returns distinct slots and tracks counts', () => {
  const w = new World(4);
  const a = w.spawn(KIND.ENEMY, 1, 2, 3, 4, 5, 6);
  const b = w.spawn(KIND.PROJECTILE, 0, 0, 0, 0, 1, 0);
  assert.notEqual(a, b);
  assert.equal(w.count, 2);
  assert.equal(w.kindCount[KIND.ENEMY], 1);
  assert.equal(w.x[a], 1);
  assert.equal(w.vy[a], 4);
  assert.equal(w.radius[a], 5);
  assert.equal(w.hp[a], 6);
});

test('despawn frees the slot for reuse', () => {
  const w = new World(4);
  const a = w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1);
  w.despawn(a);
  assert.equal(w.kind[a], KIND.NONE);
  assert.equal(w.count, 0);
  assert.equal(w.kindCount[KIND.ENEMY], 0);
  assert.equal(w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1), a);
});

test('spawn past capacity returns -1 and counts the drop', () => {
  const w = new World(2);
  w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1);
  w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1);
  assert.equal(w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1), -1);
  assert.equal(w.dropped, 1);
  assert.equal(w.count, 2);
});

test('spawn resets stale per-slot fields', () => {
  const w = new World(1);
  const a = w.spawn(KIND.PROJECTILE, 0, 0, 0, 0, 1, 0);
  w.pierce[a] = 3;
  w.lastHit[a] = 7;
  w.despawn(a);
  const b = w.spawn(KIND.PROJECTILE, 0, 0, 0, 0, 1, 0);
  assert.equal(b, a);
  assert.equal(w.pierce[b], 0);
  assert.equal(w.lastHit[b], -1);
});

test('clearKind removes only that kind', () => {
  const w = new World(8);
  w.spawn(KIND.ENEMY, 0, 0, 0, 0, 1, 1);
  w.spawn(KIND.PROJECTILE, 0, 0, 0, 0, 1, 0);
  w.spawn(KIND.PROJECTILE, 0, 0, 0, 0, 1, 0);
  w.clearKind(KIND.PROJECTILE);
  assert.equal(w.kindCount[KIND.PROJECTILE], 0);
  assert.equal(w.kindCount[KIND.ENEMY], 1);
});

test('despawn bumps the slot generation and GEM is a counted kind', () => {
  const w = new World(2);
  const a = w.spawn(KIND.GEM, 0, 0, 0, 0, 5, 0);
  assert.equal(w.kindCount[KIND.GEM], 1);
  assert.equal(w.gen[a], 0);
  w.despawn(a);
  assert.equal(w.gen[a], 1);
  assert.equal(w.kindCount[KIND.GEM], 0);
});
