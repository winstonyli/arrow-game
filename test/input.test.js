import test from 'node:test';
import assert from 'node:assert/strict';
import { keysToVector } from '../src/input/input.ts';

test('no keys gives a zero vector', () => {
  assert.deepEqual(keysToVector(new Set()), { x: 0, y: 0 });
});

test('WASD and arrows map to axes (y grows downward)', () => {
  assert.deepEqual(keysToVector(new Set(['KeyD'])), { x: 1, y: 0 });
  assert.deepEqual(keysToVector(new Set(['ArrowLeft'])), { x: -1, y: 0 });
  assert.deepEqual(keysToVector(new Set(['KeyW'])), { x: 0, y: -1 });
  assert.deepEqual(keysToVector(new Set(['ArrowDown'])), { x: 0, y: 1 });
});

test('opposing keys cancel', () => {
  assert.deepEqual(keysToVector(new Set(['KeyA', 'KeyD'])), { x: 0, y: 0 });
});

test('diagonals are normalised', () => {
  const v = keysToVector(new Set(['KeyD', 'KeyS']));
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
});
