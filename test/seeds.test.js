import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySeed, dailyLabel, customSeed, hashString, randomSeed } from '../src/replay/seeds.js';

test('dailySeed is stable per mode and local date', () => {
  const d = new Date(2026, 9, 3, 15, 30);
  assert.equal(dailySeed('arena', d), dailySeed('arena', new Date(2026, 9, 3, 1, 0)));
  assert.notEqual(dailySeed('arena', d), dailySeed('rooms', d));
  assert.notEqual(dailySeed('arena', d), dailySeed('arena', new Date(2026, 9, 4)));
  assert.equal(dailySeed('arena', d), hashString('arena:2026-10-03'));
  assert.equal(dailyLabel(d), 'Daily 2026-10-03');
});

test('customSeed trims and lowercases text, and takes small numbers verbatim', () => {
  assert.equal(customSeed('  Hello '), customSeed('hello'));
  assert.equal(customSeed('hello'), hashString('hello'));
  assert.equal(customSeed('123'), 123);
  assert.equal(customSeed('4294967295'), 4294967295);
  assert.equal(customSeed('99999999999'), hashString('99999999999')); // too big: hashed
  assert.equal(customSeed('   '), null);
  assert.equal(customSeed(''), null);
});

test('hashString and randomSeed return uint32s', () => {
  for (const v of [hashString(''), hashString('x'), randomSeed(), randomSeed()]) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
  }
});
