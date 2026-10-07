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
  const arenaIds = SKILLS.filter((s) => s.arena && !s.id.includes('.')).map((s) => s.id); // fork cards need a level-2 weapon (see branches.test.ts)
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

test('Frost is a levelled arena-only offer capped at 5', () => {
  const frost = SKILLS.find((k) => k.id === 'frost')!;
  assert.ok(frost.arena);
  const s = baseStats();
  assert.equal(frost.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) frost.apply(s);
  assert.equal(s.frost, 5);
  assert.equal(frost.available!(s), false);
  frost.apply(s);
  assert.equal(s.frost, 5);
});

test('Ignite is a levelled arena-only offer capped at 5', () => {
  const ignite = SKILLS.find((k) => k.id === 'ignite')!;
  assert.ok(ignite.arena);
  const s = baseStats();
  assert.equal(ignite.tag!(s), 'NEW');
  ignite.apply(s);
  assert.equal(ignite.tag!(s), 'Lv 1 → 2');
  for (let n = 0; n < 4; n++) ignite.apply(s);
  assert.equal(s.ignite, 5);
  assert.equal(ignite.available!(s), false);
  ignite.apply(s);
  assert.equal(s.ignite, 5);
});
