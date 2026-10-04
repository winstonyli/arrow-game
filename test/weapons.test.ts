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
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import { ENEMY_TYPES } from '../src/game/enemies.ts';
import { updateShockwave, SHOCK_LEVELS } from '../src/game/weapons/shockwave.ts';
import { updateChain, CHAIN_LEVELS, CHAIN_LIFE, CHAIN_FALLOFF } from '../src/game/weapons/chain.ts';
import { stateHash } from '../src/replay/hash.ts';
import type { Game } from '../src/game/game.ts';

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
  assert.equal(SKILLS.find((k) => k.id === 'shockwave')!.available!(s), false); // new weapon, no slot
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

const arenaGame = () => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const settle = (g: Game) => g.grid.rebuild(g.world, KIND.ENEMY); // tick() rebuilds the grid; tests that call a weapon directly do it themselves
const BRUISER_HP = ENEMY_TYPES[ENEMY.BRUISER].hp;

test('shockwave hits each enemy once as the ring crosses it and spares those out of reach', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  const near = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  const far = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 400, g.player.y);
  for (let k = 0; k < 120; k++) { // two seconds: one pulse (interval 5 s), the ring dies at 150 px after about 23 ticks
    settle(g);
    updateShockwave(g, 1, 1 / 60);
  }
  assert.equal(g.world.hp[near], BRUISER_HP - SHOCK_LEVELS[0].damage);
  assert.equal(g.world.hp[far], BRUISER_HP);
  assert.equal(g.wstate.shock.on, false);
});

test('shockwave waits for a target in reach before pulsing, then starts its interval', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  settle(g);
  assert.equal(updateShockwave(g, 1, 1 / 60), 0);
  assert.equal(g.wstate.shock.on, false);
  assert.equal(g.wstate.shock.cd, 0); // no target: no cooldown spent
  spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 50, g.player.y);
  settle(g);
  updateShockwave(g, 1, 1 / 60);
  assert.equal(g.wstate.shock.on, true);
  assert.ok(Math.abs(g.wstate.shock.cd - SHOCK_LEVELS[0].interval) < 1e-9);
});

test('shockwave scales with level, and Rapid Fire shortens its interval and Power Shot raises its damage', () => {
  const g = arenaGame();
  g.player.stats.cooldownMult = 0.5;
  g.player.stats.damageMult = 1.2; // 75 * 1.2 = 90 < the bruiser's 120 hp, so it survives to be measured
  const e = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  for (let k = 0; k < 60; k++) { // one second: the ring (320 px at 400 px/s) is done by 0.8 s, before the halved 1.5 s interval brings a second pulse
    settle(g);
    updateShockwave(g, 5, 1 / 60);
  }
  assert.ok(Math.abs(g.world.hp[e] - (BRUISER_HP - SHOCK_LEVELS[4].damage * 1.2)) < 1e-3);
  assert.equal(g.wstate.shock.max, SHOCK_LEVELS[4].radius);
  assert.ok(g.wstate.shock.cd <= SHOCK_LEVELS[4].interval * 0.5);
});

test('a shockwave kill is counted, calls onKill once and removes the enemy', () => {
  const g = arenaGame();
  const killed: number[] = [];
  g.onKill = (j) => killed.push(j);
  const e = spawnEnemy(g.world, ENEMY.CHASER, g.player.x + 60, g.player.y);
  g.world.hp[e] = 1;
  settle(g);
  let kills = 0;
  for (let k = 0; k < 60; k++) {
    settle(g);
    kills += updateShockwave(g, 1, 1 / 60);
  }
  assert.equal(kills, 1);
  assert.deepEqual(killed, [e]);
  assert.equal(g.world.kind[e], KIND.NONE);
});

test('tick runs owned weapons', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 50, g.player.y);
  tick(g, 1 / 60);
  assert.equal(g.wstate.shock.on, true);
});

test('the state hash sees weapon state', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  const before = stateHash(g);
  g.wstate.shock.r = 12;
  assert.notEqual(stateHash(g), before);
});

const at = (g: Game, dx: number, dy = 0) => spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + dx, g.player.y + dy);
const damage = (g: Game, j: number) => BRUISER_HP - g.world.hp[j];

test('chain lightning strikes the nearest enemy, then jumps outward with falling damage', () => {
  const g = arenaGame();
  const a = at(g, 100);
  const b = at(g, 180); // 80 from a
  const c = at(g, 260); // 80 from b
  const d = at(g, 500); // out of jump range of c
  settle(g);
  updateChain(g, 1, 1 / 60);
  const base = CHAIN_LEVELS[0].damage;
  assert.ok(Math.abs(damage(g, a) - base) < 1e-3);
  assert.ok(Math.abs(damage(g, b) - base * CHAIN_FALLOFF) < 1e-3);
  assert.ok(Math.abs(damage(g, c) - base * CHAIN_FALLOFF ** 2) < 1e-3);
  assert.equal(damage(g, d), 0);
  assert.equal(g.wstate.chain.n, 4); // the player plus three targets
  assert.equal(g.wstate.chain.life, CHAIN_LIFE);
});

test('chain lightning hits at most jumps + 1 distinct enemies', () => {
  const g = arenaGame();
  const ids: number[] = [];
  for (let k = 0; k < 12; k++) ids.push(at(g, 60 + k * 20, (k % 3) * 10));
  settle(g);
  updateChain(g, 1, 1 / 60);
  assert.equal(ids.filter((j) => damage(g, j) > 0).length, CHAIN_LEVELS[0].jumps + 1);
});

test('chain lightning waits for a target without spending its interval, then honours it', () => {
  const g = arenaGame();
  settle(g);
  assert.equal(updateChain(g, 1, 1 / 60), 0);
  assert.equal(g.wstate.chain.cd, 0);
  assert.equal(g.wstate.chain.life, 0);
  const e = at(g, 100);
  settle(g);
  updateChain(g, 1, 1 / 60);
  const once = damage(g, e);
  assert.ok(once > 0);
  updateChain(g, 1, 1 / 60); // within the interval
  assert.equal(damage(g, e), once);
  assert.ok(Math.abs(g.wstate.chain.cd - (CHAIN_LEVELS[0].interval - 1 / 60)) < 1e-9);
});

test('a chain-lightning kill is counted once and the chain carries on past it', () => {
  const g = arenaGame();
  const first = spawnEnemy(g.world, ENEMY.CHASER, g.player.x + 100, g.player.y);
  g.world.hp[first] = 1;
  const second = at(g, 170);
  settle(g);
  assert.equal(updateChain(g, 1, 1 / 60), 1);
  assert.equal(g.world.kind[first], KIND.NONE);
  assert.ok(damage(g, second) > 0);
});

test('chain lightning scales with level', () => {
  const g = arenaGame();
  const e = at(g, 100);
  settle(g);
  updateChain(g, 5, 1 / 60);
  assert.ok(Math.abs(damage(g, e) - CHAIN_LEVELS[4].damage) < 1e-3);
});

test('chain lightning ignores an enemy despawned after the grid was built', () => {
  const g = arenaGame();
  let kills = 0;
  g.onKill = () => kills++;
  const dead = at(g, 80);
  const live = at(g, 200);
  settle(g);
  g.world.despawn(dead);
  const free = g.world.freeCount;
  assert.equal(updateChain(g, 1, 1 / 60), 0);
  assert.equal(kills, 0);
  assert.equal(g.kills, 0);
  assert.equal(g.world.freeCount, free);
  assert.equal(new Set(g.world.free.subarray(0, g.world.freeCount)).size, g.world.freeCount);
  assert.ok(damage(g, live) > 0);
});

test("chain lightning hits jumps + 1 distinct targets at every level, with that level's damage", () => {
  for (let lv = 1; lv <= CHAIN_LEVELS.length; lv++) {
    const g = arenaGame();
    const ids: number[] = [];
    for (let k = 0; k < 12; k++) ids.push(at(g, 100 + k * 40));
    settle(g);
    updateChain(g, lv, 1 / 60);
    const L = CHAIN_LEVELS[lv - 1];
    assert.equal(ids.filter((j) => damage(g, j) > 0).length, L.jumps + 1, `level ${lv}`);
    assert.ok(Math.abs(damage(g, ids[0]) - L.damage) < 1e-3, `level ${lv}`);
  }
});
