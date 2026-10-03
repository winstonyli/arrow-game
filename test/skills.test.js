import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, applySkill, pickChoices } from '../src/game/skills.js';
import { baseStats } from '../src/game/player.js';

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
