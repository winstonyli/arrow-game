import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, dequantize } from '../src/replay/quantize.js';

test('quantize maps [-1, 1] to signed bytes and clamps', () => {
  assert.equal(quantize(0), 0);
  assert.equal(quantize(1), 127);
  assert.equal(quantize(-1), -127);
  assert.equal(quantize(5), 127);
  assert.equal(quantize(-5), -127);
  assert.equal(quantize(0.5), 64);
});

test('quantize never returns -0 or NaN', () => {
  assert.ok(Object.is(quantize(-0), 0));
  assert.ok(Object.is(quantize(-0.001), 0));
  assert.equal(quantize(NaN), 0);
});

test('every byte survives dequantize then quantize', () => {
  for (let q = -127; q <= 127; q++) assert.equal(quantize(dequantize(q)), q);
  assert.equal(dequantize(127), 1);
  assert.equal(dequantize(-127), -1);
});
