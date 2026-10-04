import test from 'node:test';
import assert from 'node:assert/strict';
import { createStepper } from '../src/core/loop.js';
import { TICK_DT } from '../src/replay/version.js';

test('advance accumulates frame time into whole steps', () => {
  const s = createStepper(60);
  assert.equal(s.advance(0.05), 3);
  assert.equal(s.advance(0.01), 0);
  assert.equal(s.advance(0.01), 1); // 0.02 accumulated
});

test('exposes the fixed dt', () => {
  assert.equal(createStepper(50).dt, 1 / 50);
});

test('caps steps after a long stall and drops the backlog', () => {
  const s = createStepper(60, 5);
  assert.equal(s.advance(10), 5);
  assert.equal(s.advance(0), 0);
});

test('the live loop steps at the replay tick rate (main.js uses createStepper())', () => {
  assert.equal(createStepper().dt, TICK_DT); // replays are recorded per TICK_DT; changing the loop rate must bump SIM_VERSION
});
