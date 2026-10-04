import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, applySkill, pickChoices } from '../src/game/skills.ts';
import { baseStats } from '../src/game/player.ts';

test('every skill changes the stats', () => {
  for (const { id } of SKILLS) {
    const s = baseStats();
    applySkill(s, id);
    assert.notDeepEqual(s, baseStats(), id);
  }
});

test('multishot adds an arrow; pierce and ricochet add counts', () => {
  const s = baseStats();
  applySkill(s, 'multishot');
  applySkill(s, 'pierce');
  applySkill(s, 'ricochet');
  assert.equal(s.projectileCount, 2);
  assert.equal(s.pierce, 1);
  assert.equal(s.bounce, 2);
});

test('applySkill rejects unknown ids', () => {
  assert.throws(() => applySkill(baseStats(), 'nope'), /unknown skill/);
});

test('pickChoices returns distinct valid ids for any rng', () => {
  const ids = new Set(SKILLS.map((s) => s.id));
  for (const rng of [() => 0, () => 0.5, () => 0.999]) {
    const picks = pickChoices(rng, 3);
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks).size, 3);
    for (const id of picks) assert.ok(ids.has(id));
  }
});

test('rooms never offers arena skills; arena does, minus owned or maxed ones', () => {
  const arenaIds = SKILLS.filter((s) => s.arena).map((s) => s.id);
  for (const rng of [() => 0, () => 0.5, () => 0.999]) {
    for (const id of pickChoices(rng, 3)) assert.ok(!arenaIds.includes(id), id);
  }
  const seen = new Set();
  for (let k = 0; k < 200; k++) pickChoices(Math.random, 3, baseStats(), true).forEach((id) => seen.add(id));
  for (const id of arenaIds) assert.ok(seen.has(id), id);
  const s = baseStats();
  applySkill(s, 'homing');
  s.weapons.blade = 5;
  for (let k = 0; k < 100; k++) {
    const picks = pickChoices(Math.random, 3, s, true);
    assert.ok(!picks.includes('homing') && !picks.includes('blade'));
  }
});
