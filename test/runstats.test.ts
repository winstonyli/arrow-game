import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND, World } from '../src/core/world.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { createPlayer } from '../src/game/player.ts';
import { spawnGem, gemSystem } from '../src/game/gems.ts';
import { applySkill } from '../src/game/skills.ts';
import { hitEnemy, statusSystem, HIT_CRIT, HIT_KNOCK, HIT_STATUS } from '../src/game/hit.ts';
import { CRIT_MULT, VAMP_HP, IGNITE_DPS } from '../src/game/modifiers.ts';
import { SOURCE_IDS, SRC_OF, SRC, UP, HEAL, ACT } from '../src/game/runstats.ts';
import { formatRunStats } from '../src/game/runstats-report.ts';
import { seeded } from '../src/core/math.ts';
import type { Game } from '../src/game/game.ts';

const arenaGame = () => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const at = (g: Game, dx: number) => spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + dx, g.player.y);
const sum = (a: Float64Array) => a.reduce((x, y) => x + y, 0);
const total = (g: Game) => sum(g.stats.dmg) + sum(g.stats.up);
const apply = (g: Game, id: string, n: number) => { for (let k = 0; k < n; k++) applySkill(g.player.stats, id); };

test('damage is credited to the hit source and overkill is not counted', () => {
  const g = arenaGame();
  const j = at(g, 100);
  const hp = g.world.hp[j];
  g.hitSrc = SRC_OF.chain;
  hitEnemy(g, j, hp * 10, 0, 0, 0);
  assert.equal(g.stats.dmg[SRC_OF.chain], hp);
  assert.equal(total(g), hp);
});

test('Big Numbers takes (1 - 1/damageMult) of a hit; shares and sources sum to the effective damage', () => {
  const g = arenaGame();
  apply(g, 'power', 2);
  const mult = g.player.stats.damageMult;
  assert.ok(mult > 1);
  const j = at(g, 100);
  g.hitSrc = SRC.BLADE; // not timed: no Quick Draw / Multishot share
  hitEnemy(g, j, 10, 0, 0, 0);
  assert.ok(Math.abs(g.stats.up[UP.POWER] - 10 * (1 - 1 / mult)) < 1e-9);
  assert.ok(Math.abs(total(g) - 10) < 1e-9);
});

test('a guaranteed crit credits Lucky Strike the bonus half', () => {
  const g = arenaGame();
  g.player.stats.crit = 100; // chance clamps well above 1
  const j = at(g, 100);
  g.hitSrc = SRC.BLADE;
  hitEnemy(g, j, 10, HIT_CRIT, 0, 0);
  const eff = 10 * CRIT_MULT;
  assert.ok(Math.abs(g.stats.up[UP.CRIT] - eff * (1 - 1 / CRIT_MULT)) < 1e-9);
  assert.ok(Math.abs(total(g) - eff) < 1e-9);
});

test('Multishot credits only bow hits; Quick Draw only timed sources', () => {
  const g = arenaGame();
  g.player.stats.projectileCount = 3;
  g.player.stats.cooldownMult = 0.5;
  const a = at(g, 100);
  g.hitSrc = SRC.BOW;
  hitEnemy(g, a, 9, 0, 0, 0);
  assert.ok(Math.abs(g.stats.up[UP.MULTI] - 6) < 1e-9); // 2/3 of 9
  assert.ok(Math.abs(g.stats.up[UP.RAPID] - 1.5) < 1e-9); // half of the remaining 3
  const b = at(g, 200);
  const before = g.stats.up[UP.RAPID];
  g.hitSrc = SRC_OF.beam; // untimed
  hitEnemy(g, b, 9, 0, 0, 0);
  assert.equal(g.stats.up[UP.RAPID], before);
  assert.ok(Math.abs(g.stats.up[UP.MULTI] - 6) < 1e-9);
  assert.ok(Math.abs(total(g) - 18) < 1e-9);
});

test('burn damage goes to the burn source', () => {
  const g = arenaGame();
  apply(g, 'ignite', 1);
  const j = at(g, 100);
  g.world.burnT[j] = 1;
  statusSystem(g, 1 / 60);
  assert.ok(Math.abs(g.stats.dmg[SRC.BURN] - IGNITE_DPS / 60 * g.player.stats.damageMult) < 1e-6);
});

test('Vampiric and Chicken Soup credit only the hp actually gained', () => {
  const g = arenaGame();
  apply(g, 'vamp', 1);
  g.player.hp = g.player.maxHp; // full: nothing to gain
  hitEnemy(g, at(g, 100), 1e6, 0, 0, 0);
  assert.equal(g.stats.heal[HEAL.VAMP], 0);
  g.player.hp = g.player.maxHp - 0.5; // room for half a heal
  hitEnemy(g, at(g, 100), 1e6, 0, 0, 0);
  assert.ok(Math.abs(g.stats.heal[HEAL.VAMP] - 0.5) < 1e-9);
  assert.ok(VAMP_HP > 0.5);

  const r = arenaGame();
  apply(r, 'regen', 2);
  r.player.hp = r.player.maxHp - 1;
  for (let t = 0; t < 600; t++) tick(r, 1 / 60); // far more regen than the 1 hp missing (a hit may also cost hp: only gains count)
  assert.ok(r.stats.heal[HEAL.REGEN] > 0);
});

test('activity counters: px pushed, enemy-seconds slowed, extended-ring gems, arrows fired', () => {
  const g = arenaGame();
  apply(g, 'knockback', 1);
  apply(g, 'frost', 1);
  const j = at(g, 100);
  const x0 = g.world.x[j];
  g.hitSrc = SRC.BOW;
  hitEnemy(g, j, 1, HIT_KNOCK | HIT_STATUS, 1, 0);
  assert.ok(Math.abs(g.stats.act[ACT.PUSHED] - Math.abs(g.world.x[j] - x0)) < 1e-6);
  assert.ok(g.stats.act[ACT.PUSHED] > 0);
  statusSystem(g, 0.5);
  assert.ok(Math.abs(g.stats.act[ACT.SLOWED] - 0.5) < 1e-6);

  const world = new World(20);
  const player = createPlayer(450, 500);
  const gg = arenaGame();
  spawnGem(world, 450, 450, 1); // inside the base radius
  gemSystem(world, player, 1 / 60, gg.stats);
  assert.equal(gg.stats.act[ACT.MAGNET], 0);
  player.stats.pickupRadius = 200;
  spawnGem(world, 450, 400, 1); // 100 away: only the extended ring reaches it
  gemSystem(world, player, 1 / 60, gg.stats);
  assert.equal(gg.stats.act[ACT.MAGNET], 1);

  const f = arenaGame();
  at(f, 150);
  for (let t = 0; t < 120; t++) tick(f, 1 / 60);
  assert.ok(f.stats.act[ACT.ARROWS] > 0);
});

test('a maxed build over a run: no hit goes unclaimed, and the report states the shares are approximate', () => {
  const g = createGame({ capacity: 20000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(7), input: { x: 0.6, y: 0.3 } });
  g.player.hp = g.player.maxHp = 1e9;
  for (const id of ['blade', 'shockwave', 'chain', 'boomerang', 'flame', 'mines', 'meteor', 'beam', 'drone', 'daggers', 'crit', 'knockback', 'explode', 'vamp', 'frost', 'ignite', 'power', 'rapid', 'multishot']) apply(g, id, 4);
  for (let t = 0; t < 1800; t++) { g.offer = null; tick(g, 1 / 60); }
  assert.equal(g.stats.dmg[SRC.OTHER], 0, SOURCE_IDS.map((id, i) => `${id}=${g.stats.dmg[i].toFixed(1)}`).join(' '));
  assert.ok(g.stats.dmg[SRC.BOW] > 0);
  assert.ok(sum(g.stats.up) > 0);
  const text = formatRunStats(g.stats).join('\n');
  assert.match(text, /approximate/);
  assert.match(text, /Damage dealt/);
});
