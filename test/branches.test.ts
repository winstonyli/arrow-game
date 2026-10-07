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
