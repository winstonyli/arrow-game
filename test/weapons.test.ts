import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';
import { baseStats, createPlayer, fireVolley, autoFire } from '../src/game/player.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { SKILLS, applySkill, pickChoices, offerTag } from '../src/game/skills.ts';
import { MAX_WEAPONS, WEAPONS } from '../src/game/weapons.ts';
import { BLADE_LEVELS } from '../src/game/weapons/blade.ts';
import { MAX_BLADES, BLADE_DPS } from '../src/game/orbit.ts';

test('baseStats carries the weapon fields', () => {
  const s = baseStats();
  assert.deepEqual(s.weapons, {});
  assert.equal(s.damageMult, 1);
  assert.equal(s.cooldownMult, 1);
  assert.equal(s.bladeDps, BLADE_DPS);
});

test('a weapon skill levels the weapon, and orbit blade writes its count and damage rate', () => {
  const s = baseStats();
  applySkill(s, 'blade');
  assert.equal(s.weapons.blade, 1);
  assert.equal(s.orbit, BLADE_LEVELS[0].count);
  for (let k = 0; k < 4; k++) applySkill(s, 'blade');
  assert.equal(s.weapons.blade, 5);
  assert.equal(s.orbit, MAX_BLADES);
  assert.equal(s.bladeDps, BLADE_LEVELS[4].dps);
  applySkill(s, 'blade'); // past the cap: clamped, not an error
  assert.equal(s.weapons.blade, 5);
});

test('the last blade level fills the renderers\' MAX_BLADES buffers exactly', () => {
  assert.equal(BLADE_LEVELS[BLADE_LEVELS.length - 1].count, MAX_BLADES);
  assert.equal(BLADE_LEVELS.length, 5);
});

test('every weapon is an arena skill with a level table that matches maxLevel', () => {
  for (const w of WEAPONS) {
    const skill = SKILLS.find((k) => k.id === w.id);
    assert.ok(skill, w.id);
    assert.equal(skill.arena, true, w.id);
    assert.equal(w.maxLevel, 5, w.id);
  }
});

test('a maxed weapon is no longer offered; an owned one still is', () => {
  const s = baseStats();
  s.weapons.blade = 4;
  let seen = false;
  for (let k = 0; k < 100; k++) if (pickChoices(Math.random, 3, s, true).includes('blade')) seen = true;
  assert.ok(seen);
  s.weapons.blade = 5;
  for (let k = 0; k < 100; k++) assert.ok(!pickChoices(Math.random, 3, s, true).includes('blade'));
});

test('the slot cap stops new weapons but not level-ups of owned ones', () => {
  const s = baseStats();
  s.weapons = { blade: 1, x1: 1, x2: 1, x3: 1 }; // four weapons + the bow = MAX_WEAPONS
  assert.equal(Object.keys(s.weapons).length + 1, MAX_WEAPONS);
  const blade = SKILLS.find((k) => k.id === 'blade')!;
  assert.equal(blade.available!(s), true); // owned, below max
  const other = WEAPONS.find((w) => w.id !== 'blade');
  if (other) assert.equal(SKILLS.find((k) => k.id === other.id)!.available!(s), false); // new weapon, no slot
});

test('offerTag says NEW for an unowned weapon, the level step for an owned one, and nothing for a passive', () => {
  const s = baseStats();
  assert.equal(offerTag(s, 'blade'), 'NEW');
  applySkill(s, 'blade');
  assert.equal(offerTag(s, 'blade'), 'Lv 1 → 2');
  assert.equal(offerTag(s, 'multishot'), '');
});

test('rooms never offers a weapon', () => {
  const ids = new Set(WEAPONS.map((w) => w.id));
  for (const rng of [() => 0, () => 0.5, () => 0.999]) for (const id of pickChoices(rng, 3)) assert.ok(!ids.has(id), id);
});

test('Power Shot and Rapid Fire are global multipliers that the bow reads', () => {
  const s = baseStats();
  applySkill(s, 'power');
  applySkill(s, 'rapid');
  assert.ok(Math.abs(s.damageMult - 1.4) < 1e-12);
  assert.ok(Math.abs(s.cooldownMult - 1 / 1.3) < 1e-12);
  assert.equal(s.damage, 10); // the bow's own base is untouched

  const world = new World(100);
  const grid = new Grid(900, 600, 64, 100);
  const player = createPlayer(450, 300);
  player.stats = s;
  fireVolley(world, player, 0);
  assert.ok(Math.abs(world.damage[world.high - 1] - 14) < 1e-4);

  spawnEnemy(world, ENEMY.CHASER, 500, 300);
  grid.rebuild(world, KIND.ENEMY);
  player.cd = 0;
  autoFire(player, world, grid, 0);
  assert.ok(Math.abs(player.cd - 0.5 / 1.3) < 1e-9);
});
