import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND } from '../src/core/world.ts';
import { createGame } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import { spawnEnemy, ENEMY, ENEMY_TYPES } from '../src/game/enemies.ts';
import { SKILLS_BY_ID, applySkill, pickChoices, offerTag } from '../src/game/skills.ts';
import { baseStats } from '../src/game/player.ts';
import { stateHash } from '../src/replay/hash.ts';
import { icon } from '../src/ui/icons.ts';
import { hudModel } from '../src/ui/model.ts';
import { updateChain, CHAIN_LEVELS, CHAIN_RANGE, CHAIN_JUMP, MAX_JUMPS, CORONA_LEVELS, CORONA_RADIUS, DAISY_DMG } from '../src/game/weapons/chain.ts';
import { MAX_BOLT_DOTS, BOLT_DOT_GAP } from '../src/render/webgl.ts';
import { updateShockwave, SHOCK_LEVELS, SHOCK_SPEED, AFTER_DELAY, AFTER_DMG, AFTER_ECHO, FISSURE_RANGE, FISSURE_DMG, FISSURE_HALF } from '../src/game/weapons/shockwave.ts';
import { SHOVE_PX } from '../src/game/hit.ts';
import { bladePos, BLADE_ORBIT, BLADE_SPEED, BLADE_BRANCH } from '../src/game/orbit.ts';
import { BLADE_LEVELS } from '../src/game/weapons/blade.ts';
import { updateDrone, DRONE_LEVELS, DRONE_MAX } from '../src/game/weapons/drone.ts';
import type { Game } from '../src/game/game.ts';

const arenaGame = (): Game => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const settle = (g: Game) => g.grid.rebuild(g.world, KIND.ENEMY);
const BRUISER_HP = ENEMY_TYPES[ENEMY.BRUISER].hp;
const hurt = (g: Game, j: number) => g.world.hp[j] < BRUISER_HP - 1e-3;

test('a fork is offered as a pair at level 2 with no branch, and the base card is withheld', () => {
  const s = baseStats();
  s.weapons.chain = 2;
  const rng = seeded(5);
  let sawPair = false;
  for (let k = 0; k < 300; k++) {
    const ids = pickChoices(rng, 3, s, true);
    assert.ok(!ids.includes('chain'), 'base card withheld');
    assert.equal(ids.includes('chain.a'), ids.includes('chain.b'), 'the pair travels together');
    if (ids.includes('chain.a')) sawPair = true;
  }
  assert.ok(sawPair);
});

test('no fork at level 1, at level 3+, or once a branch is chosen; rooms never sees one', () => {
  for (const [lvl, br] of [[1, 0], [3, 0], [3, 1], [2, 1]] as const) {
    const s = baseStats();
    s.weapons.chain = lvl;
    s.branches.chain = br;
    const rng = seeded(9);
    for (let k = 0; k < 200; k++) {
      const ids = pickChoices(rng, 3, s, true);
      assert.ok(!ids.includes('chain.a') && !ids.includes('chain.b'), `lvl ${lvl} br ${br}`);
    }
  }
  const rng = seeded(3);
  for (let k = 0; k < 100; k++) for (const id of pickChoices(rng, 3)) assert.ok(!id.includes('.'), id);
});

test('a branch pick sets level 3 and the branch; the base card then levels 4 and 5', () => {
  const s = baseStats();
  s.weapons.chain = 2;
  applySkill(s, 'chain.b');
  assert.equal(s.weapons.chain, 3);
  assert.equal(s.branches.chain, 2);
  assert.equal(offerTag(s, 'chain.b'), 'FORK');
  applySkill(s, 'chain');
  assert.equal(s.weapons.chain, 4);
  assert.equal(s.branches.chain, 2);
  assert.ok(SKILLS_BY_ID['chain.a'] && SKILLS_BY_ID['chain.b']);
});

test('the branch is hashed', () => {
  const a = arenaGame();
  const b = arenaGame();
  assert.equal(stateHash(a), stateHash(b));
  b.player.stats.branches.chain = 1;
  assert.notEqual(stateHash(a), stateHash(b));
});

test('a branch id draws its weapon icon and the HUD folds it into the weapon chip', () => {
  assert.equal(icon('chain.a'), icon('chain'));
  const g = arenaGame();
  g.skills = { chain: 2, 'chain.a': 1, power: 1 };
  assert.deepEqual(hudModel(g, 'arena').skills, [{ id: 'chain', count: 3 }, { id: 'power', count: 1 }]);
});

test('Corona Wire zaps the N nearest enemies inside the aura at once and nothing outside it', () => {
  const g = arenaGame();
  g.player.stats.weapons.chain = 3;
  g.player.stats.branches.chain = 1;
  const C = CORONA_LEVELS[0];
  const inside: number[] = [];
  for (let k = 0; k < C.n + 2; k++) inside.push(spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 20 + k * 10, g.player.y));
  const outside = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + CORONA_RADIUS + 40, g.player.y);
  settle(g);
  updateChain(g, 3, 1 / 60);
  inside.forEach((j, k) => assert.equal(hurt(g, j), k < C.n, `enemy ${k}`)); // the nearest N, no more
  assert.ok(!hurt(g, outside));
  assert.equal(g.wstate.chain.n, 2 * C.n);
  assert.ok(g.wstate.chain.life > 0);
});

test('Corona Wire reaches an enemy well past the old 90 px aura', () => {
  const g = arenaGame();
  g.player.stats.weapons.chain = 3;
  g.player.stats.branches.chain = 1;
  const far = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 150, g.player.y);
  settle(g);
  updateChain(g, 3, 1 / 60);
  assert.ok(CORONA_RADIUS > 150 && hurt(g, far));
});

test('Daisy Chain jumps three more times, weaker per hit but with less falloff', () => {
  const line = (branch: number) => {
    const g = arenaGame();
    g.player.stats.weapons.chain = 5;
    g.player.stats.branches.chain = branch;
    const ids: number[] = [];
    for (let k = 0; k < 11; k++) ids.push(spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 50 + k * 60, g.player.y));
    settle(g);
    updateChain(g, 5, 1 / 60);
    return { g, ids };
  };
  const base = line(0);
  const daisy = line(2);
  assert.equal(base.ids.filter((j) => hurt(base.g, j)).length, CHAIN_LEVELS[4].jumps + 1);
  assert.equal(daisy.ids.filter((j) => hurt(daisy.g, j)).length, CHAIN_LEVELS[4].jumps + 3 + 1);
  assert.ok(Math.abs(daisy.g.world.hp[daisy.ids[0]] - (BRUISER_HP - CHAIN_LEVELS[4].damage * DAISY_DMG)) < 1e-2);
});

test('the bolt and path buffers hold a full-length Daisy Chain zap', () => {
  assert.ok(Math.ceil((CHAIN_RANGE + MAX_JUMPS * CHAIN_JUMP) / BOLT_DOT_GAP) + MAX_JUMPS + 1 <= MAX_BOLT_DOTS);
  const g = arenaGame();
  assert.ok(g.wstate.chain.px.length >= MAX_JUMPS + 2);
  assert.ok(g.wstate.chain.px.length >= 2 * CORONA_LEVELS[CORONA_LEVELS.length - 1].n);
});

const quake = (branch: number, level = 3): Game => {
  const g = arenaGame();
  g.player.stats.weapons.shockwave = level;
  g.player.stats.branches.shockwave = branch;
  return g;
};
const run = (g: Game, secs: number) => { for (let k = 0; k < Math.round(secs * 60); k++) { settle(g); updateShockwave(g, g.player.stats.weapons.shockwave, 1 / 60); } };

test('Aftershock sends a second ring 0.4 s later at 60% damage, and both rings shove without Personal Space', () => {
  const L = SHOCK_LEVELS[2];
  const g = quake(1);
  const j = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  const x0 = g.world.x[j];
  run(g, 0.4); // ring 1 has crossed it, ring 2 has not started
  assert.ok(Math.abs(g.world.hp[j] - (BRUISER_HP - L.damage * AFTER_DMG)) < 1e-2);
  const pushed1 = g.world.x[j] - x0;
  assert.ok(pushed1 > SHOVE_PX - 1e-2, 'shoved');
  run(g, 0.5); // ring 2 arrives
  const second = BRUISER_HP - L.damage * AFTER_DMG - L.damage * AFTER_DMG * AFTER_ECHO;
  assert.ok(Math.abs(g.world.hp[j] - second) < 1e-2);
  assert.ok(g.world.x[j] - x0 > 2 * SHOVE_PX - 1, 'shoved twice');
});

test('Fissure is a narrow crack toward the nearest enemy that reaches FISSURE_RANGE farther and hits FISSURE_DMG harder', () => {
  const L = SHOCK_LEVELS[2];
  const g = quake(2);
  const far = L.radius * 1.5; // beyond the ring's reach, inside the crack's
  const onLine = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + far, g.player.y);
  const off = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + far + 40, g.player.y + FISSURE_HALF + 40); // beside the line, and farther than the target
  run(g, 2);
  assert.ok(Math.abs(g.world.hp[onLine] - (BRUISER_HP - L.damage * FISSURE_DMG)) < 1e-2);
  assert.equal(g.world.hp[off], BRUISER_HP);
  assert.equal(L.radius * FISSURE_RANGE > far, true);
});

test('the shockwave branch state is hashed', () => {
  const a = quake(1);
  const b = quake(1);
  const j = (g: Game) => spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  j(a); j(b);
  run(a, 0.5); run(b, 0.3);
  assert.notEqual(stateHash(a), stateHash(b));
});

test('a ring hits each enemy once even when a push carries it ahead of the ring', () => {
  const L = SHOCK_LEVELS[2];
  const g = quake(0);
  g.player.stats.knockback = 3; // a 30 px push, far more than the ring advances per tick
  const j = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  g.world.hp[j] = 10000;
  run(g, L.radius / SHOCK_SPEED + 0.1);
  assert.equal(g.world.hp[j], 10000 - L.damage);
});

test('Carousel widens the orbit and Blender tightens and doubles the spin; both change dps', () => {
  const at = (branch: number, time: number) => {
    const g = arenaGame();
    g.player.stats.orbit = 1;
    g.player.stats.branches.blade = branch;
    const out = { x: 0, y: 0 };
    bladePos(g.player, time, 0, out);
    return { r: Math.hypot(out.x - g.player.x, out.y - g.player.y), a: Math.atan2(out.y - g.player.y, out.x - g.player.x) };
  };
  assert.ok(Math.abs(at(0, 0.1).r - BLADE_ORBIT) < 1e-3);
  assert.ok(Math.abs(at(1, 0.1).r - 100) < 1e-3);
  assert.ok(Math.abs(at(2, 0.1).r - 40) < 1e-3);
  assert.ok(Math.abs(at(2, 0.1).a - 2 * BLADE_SPEED * 0.1) < 1e-6);
  const s = baseStats();
  s.weapons.blade = 2;
  applySkill(s, 'blade.b');
  assert.ok(Math.abs(s.bladeDps - BLADE_LEVELS[2].dps * BLADE_BRANCH[2].dps) < 1e-9);
  assert.equal(s.orbit, BLADE_LEVELS[2].count);
  applySkill(s, 'blade'); // level 4 keeps the multiplier
  assert.ok(Math.abs(s.bladeDps - BLADE_LEVELS[3].dps * BLADE_BRANCH[2].dps) < 1e-9);
});

test('Hive Mind adds two drones at 70% damage each; Stinger reaches 1.6x farther, hits 1.5x harder, fires 1.3x slower', () => {
  const L = DRONE_LEVELS[4];
  const hive = arenaGame();
  hive.player.stats.weapons.drone = 5;
  hive.player.stats.branches.drone = 1;
  const t = spawnEnemy(hive.world, ENEMY.BRUISER, hive.player.x + 150, hive.player.y);
  settle(hive);
  updateDrone(hive, 5, 1 / 60);
  assert.equal(DRONE_MAX, 5);
  assert.deepEqual([...hive.wstate.drones.on], [1, 1, 1, 1, 1]);
  assert.ok(hive.world.hp[t] <= BRUISER_HP - L.dmg * 0.7 + 1e-2); // at least the first drone stung

  const sting = arenaGame();
  sting.player.stats.weapons.drone = 5;
  sting.player.stats.branches.drone = 2;
  const far = spawnEnemy(sting.world, ENEMY.BRUISER, sting.player.x + L.range * 1.4, sting.player.y); // beyond L.range, within 1.6x of the (-32,-32) drone
  settle(sting);
  updateDrone(sting, 5, 1 / 60);
  assert.ok(Math.abs(sting.world.hp[far] - (BRUISER_HP - L.dmg * 1.5)) < 1e-2);
  assert.ok(Math.abs(sting.wstate.drones.cd[0] - L.interval * 1.3) < 1e-3);
  assert.deepEqual([...sting.wstate.drones.on], [1, 1, 1, 0, 0]); // level 5 holds 3 drones; Stinger adds none
});
