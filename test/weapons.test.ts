import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';
import { baseStats, createPlayer, fireVolley, autoFire } from '../src/game/player.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { SKILLS, applySkill, pickChoices, offerTag } from '../src/game/skills.ts';
import { MAX_WEAPONS, WEAPONS } from '../src/game/weapons.ts';
import { CRIT_MULT } from '../src/game/modifiers.ts';
import { BLADE_LEVELS } from '../src/game/weapons/blade.ts';
import { MAX_BLADES, BLADE_DPS } from '../src/game/orbit.ts';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import { ENEMY_TYPES } from '../src/game/enemies.ts';
import { updateShockwave, SHOCK_LEVELS } from '../src/game/weapons/shockwave.ts';
import { updateChain, CHAIN_LEVELS, CHAIN_LIFE, CHAIN_FALLOFF } from '../src/game/weapons/chain.ts';
import { updateBoomerang, BOOM_LEVELS, BOOM_RADIUS } from '../src/game/weapons/boomerang.ts';
import { updateFlame, FLAME_LEVELS, FIRE_CAP, FIRE_SPACING, FIRE_TICK } from '../src/game/weapons/flame.ts';
import { updateMines, MINE_LEVELS, MINE_CAP, MINE_SPACING, MINE_LIFE, MINE_ARM } from '../src/game/weapons/mines.ts';
import { updateMeteors, METEOR_LEVELS, METEOR_CAP, METEOR_RANGE, METEOR_TELEGRAPH } from '../src/game/weapons/meteor.ts';
import { updateBeam, BEAM_LEVELS, BEAM_TICK } from '../src/game/weapons/beam.ts';
import { updateDrone, DRONE_LEVELS, DRONE_OFFSETS, DRONE_TRACER, droneAlpha } from '../src/game/weapons/drone.ts';
import { updateDaggers, DAGGER_LEVELS, DAGGER_CAP, DAGGER_SPEED, DAGGER_SPREAD } from '../src/game/weapons/daggers.ts';
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
  g.world.hp[dead] = 0; // as after a contact or blade kill earlier in the tick: a stale slot has hp <= 0
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

test('a boomerang flies out toward the nearest enemy, damages it on the way, returns and goes idle', () => {
  const g = arenaGame();
  const e = at(g, 200);
  const phases = new Set<number>();
  for (let k = 0; k < 400 && !(phases.has(2) && g.wstate.boom.b[0].phase === 0); k++) {
    settle(g);
    updateBoomerang(g, 1, 1 / 60);
    phases.add(g.wstate.boom.b[0].phase);
  }
  assert.deepEqual([...phases].sort(), [0, 1, 2]);
  assert.ok(damage(g, e) > 0);
  assert.ok(g.wstate.boom.b[0].cd > 0); // relaunch cooldown running
});

test('boomerang contact damage is its damage rate times dt, scaled by Power Shot', () => {
  const g = arenaGame();
  g.player.stats.damageMult = 2;
  const e = at(g, 300);
  const b = g.wstate.boom.b[0];
  b.phase = 1;
  b.x = g.player.x + 300;
  b.y = g.player.y;
  b.dx = 1;
  b.dy = 0;
  b.dist = 0;
  settle(g);
  updateBoomerang(g, 1, 0.01);
  assert.ok(Math.abs(damage(g, e) - BOOM_LEVELS[0].dps * 2 * 0.01) < 1e-3);
});

test('boomerang count follows the level: two are out by one second at level 3', () => {
  const g = arenaGame();
  at(g, 150);
  for (let k = 0; k < 60; k++) {
    settle(g);
    updateBoomerang(g, 3, 1 / 60);
  }
  assert.equal(g.wstate.boom.b.filter((b) => b.phase !== 0).length, BOOM_LEVELS[2].count);
});

test('a boomerang does not launch without a target in range, and a kill is counted', () => {
  const g = arenaGame();
  settle(g);
  updateBoomerang(g, 1, 1 / 60);
  assert.equal(g.wstate.boom.b[0].phase, 0);
  const e = spawnEnemy(g.world, ENEMY.CHASER, g.player.x + 100, g.player.y);
  g.world.hp[e] = 1;
  let kills = 0;
  for (let k = 0; k < 120; k++) {
    settle(g);
    kills += updateBoomerang(g, 1, 1 / 60);
  }
  assert.equal(kills, 1);
  assert.equal(g.world.kind[e], KIND.NONE);
});

test('boomerang radius is the size the renderers draw', () => {
  assert.equal(BOOM_RADIUS, 10);
});

test('a boomerang ignores an enemy despawned after the grid was built', () => {
  const g = arenaGame();
  const dead = at(g, 300);
  settle(g);
  g.world.hp[dead] = 0; // as after a contact or blade kill earlier in the tick: a stale slot has hp <= 0
  g.world.despawn(dead);
  const b = g.wstate.boom.b[0];
  b.phase = 1;
  b.x = g.player.x + 300;
  b.y = g.player.y;
  b.dx = 1;
  b.dy = 0;
  b.dist = 0;
  let killed = 0;
  g.onKill = () => killed++;
  assert.equal(updateBoomerang(g, 1, 0.01), 0);
  assert.equal(killed, 0);
});

const live = (g: Game) => g.wstate.fire.life.reduce((n, l) => n + (l > 0 ? 1 : 0), 0);
const move = (g: Game, dx: number) => { g.player.x += dx; };

test('flame drops a patch on the first update, none while standing still, one per FIRE_SPACING moved', () => {
  const g = arenaGame();
  settle(g);
  updateFlame(g, 1, 1 / 60);
  assert.equal(live(g), 1);
  for (let t = 0; t < 30; t++) updateFlame(g, 1, 1 / 60); // still: no new patch
  assert.equal(live(g), 1);
  move(g, FIRE_SPACING - 1);
  updateFlame(g, 1, 1 / 60);
  assert.equal(live(g), 1); // not far enough
  move(g, 1);
  updateFlame(g, 1, 1 / 60);
  assert.equal(live(g), 2);
});

test('flame overwrites the oldest patch when the ring is full', () => {
  const g = arenaGame();
  settle(g);
  for (let k = 0; k < FIRE_CAP + 5; k++) {
    updateFlame(g, 5, 1e-6); // long life, essentially no aging
    move(g, FIRE_SPACING);
  }
  assert.equal(live(g), FIRE_CAP);
  assert.equal(g.wstate.fire.head, 5); // wrapped five slots past the start
});

test('a patch ticks an overlapping enemy every FIRE_TICK, not more often, and ignores a distant one', () => {
  const g = arenaGame();
  g.player.stats.damageMult = 1;
  const near = at(g, 0, 0); // on the first patch
  const far = at(g, 200, 0);
  settle(g);
  updateFlame(g, 1, 1 / 60); // drops the patch (cd 0)
  const dt = 1 / 60;
  let ticks = 0;
  let before = damage(g, near);
  for (let t = 0; t < 60; t++) { // one second
    updateFlame(g, 1, dt);
    const d = damage(g, near);
    if (d > before) ticks++;
    before = d;
  }
  assert.equal(ticks, 4); // 1 s / 0.25 s
  assert.ok(Math.abs(damage(g, near) - FLAME_LEVELS[0].dps * FIRE_TICK * 4) < 1e-3);
  assert.equal(damage(g, far), 0);
});

test('patch damage scales with damageMult and level', () => {
  const run = (level: number, mult: number) => {
    const g = arenaGame();
    g.player.stats.damageMult = mult;
    const j = at(g, 0, 0);
    settle(g);
    updateFlame(g, level, 1 / 60);
    for (let t = 0; t < 20; t++) updateFlame(g, level, 1 / 60); // crosses one tick
    return damage(g, j);
  };
  const base = run(1, 1);
  assert.ok(base > 0);
  assert.ok(Math.abs(run(1, 2) - 2 * base) < 1e-3);
  assert.ok(Math.abs(run(3, 1) / base - FLAME_LEVELS[2].dps / FLAME_LEVELS[0].dps) < 1e-3);
});

test('a surviving patch tick applies Frost and Ignite but never crits or pushes', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.frost = 1; s.ignite = 1; s.crit = 10; s.knockback = 5; s.damageMult = 1; // crit 10 = chance 1, so any crit flag would show
  const j = at(g, 6, 0); // off-centre of the patch, so a knock would have a direction and move it
  settle(g);
  const x0 = g.world.x[j];
  updateFlame(g, 1, 1 / 60);
  for (let t = 0; t < 10 /* first tick only: the second lands ~15 updates later */; t++) updateFlame(g, 1, 1 / 60);
  assert.ok(g.world.slowT[j] > 0);
  assert.ok(g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0); // no knockback
  assert.ok(Math.abs(damage(g, j) - FLAME_LEVELS[0].dps * FIRE_TICK) < 1e-3); // exactly one tick, no crit
});

test('a patch expires after its life and stops hitting', () => {
  const g = arenaGame();
  g.player.stats.damageMult = 1;
  const j = at(g, 0, 0);
  settle(g);
  updateFlame(g, 1, 1 / 60);
  for (let t = 0; t < 60 * 3; t++) updateFlame(g, 1, 1 / 60); // life is 2 s
  assert.equal(live(g), 0);
  const d = damage(g, j);
  for (let t = 0; t < 60; t++) updateFlame(g, 1, 1 / 60);
  assert.equal(damage(g, j), d);
});

test('a patch kill counts once, heals and queues a blast; over a crowd kills equal onKill calls with no double kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  const j = at(g, 0, 0);
  g.world.hp[j] = 0.001;
  settle(g);
  updateFlame(g, 1, 1 / 60);
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  let kills = 0;
  for (let t = 0; t < 20; t++) kills += updateFlame(g, 1, 1 / 60);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x + (n % 8) * 3, g2.player.y + Math.floor(n / 8) * 3);
    g2.world.hp[e] = 0.01;
  }
  settle(g2);
  const seen: number[] = [];
  g2.onKill = (x) => seen.push(g2.world.gen[x] * 100000 + x);
  updateFlame(g2, 5, 1 / 60);
  let k2 = 0;
  for (let t = 0; t < 20; t++) { settle(g2); k2 += updateFlame(g2, 5, 1 / 60); }
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('stateHash changes with a patch life and with the drop point', () => {
  const g = arenaGame();
  settle(g);
  const empty = stateHash(g);
  updateFlame(g, 1, 1 / 60);
  const dropped = stateHash(g);
  assert.notEqual(dropped, empty);
  g.wstate.fire.life[0] -= 0.5;
  const aged = stateHash(g);
  assert.notEqual(aged, dropped);
  g.wstate.fire.life[0] += 0.5;
  g.wstate.fire.lx += 1;
  assert.notEqual(stateHash(g), dropped);
});

test('Flame trail is a levelled arena-only weapon offer that takes a slot, with an icon', () => {
  const flame = SKILLS.find((k) => k.id === 'flame')!;
  assert.ok(flame.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'flame'));
  const s = baseStats();
  assert.equal(flame.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) applySkill(s, 'flame');
  assert.equal(s.weapons.flame, 5);
  assert.equal(flame.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 }; // the bow plus four fill the five slots
  assert.equal(flame.available!(full), false);
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS); // four weapons plus the bow fill the slots
});

const liveMines = (g: Game) => g.wstate.mines.on.reduce((n, v) => n + v, 0);
const BR = ENEMY_TYPES[ENEMY.BRUISER].radius;
const run = (g: Game, level: number, secs: number) => {
  let kills = 0;
  for (let t = 0; t < Math.round(secs * 60); t++) { settle(g); kills += updateMines(g, level, 1 / 60); }
  return kills;
};

test('mines drop one on the first update, none while standing still, and another only after the interval and 20 px', () => {
  const g = arenaGame();
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), 1);
  run(g, 1, 5); // standing still: spacing never met, so the timer waits and nothing drops
  assert.equal(liveMines(g), 1);
  g.player.x += MINE_SPACING; // far enough, and the 3 s interval has long elapsed: drops on the next update
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), 2);
  g.player.x += MINE_SPACING; // far enough again but the interval was just reset: waits for it
  run(g, 1, 1);
  assert.equal(liveMines(g), 2);
  run(g, 1, 2.1);
  assert.equal(liveMines(g), 3);
  g.player.x += MINE_SPACING - 1; // not far enough
  run(g, 1, 3.5); // past the 3 s interval, yet short of the first mine's 12 s life
  assert.equal(liveMines(g), 3);
});

test('a full pool skips the drop and overwrites nothing', () => {
  const g = arenaGame();
  const m = g.wstate.mines;
  for (let k = 0; k < MINE_CAP; k++) { m.on[k] = 1; m.x[k] = 100000 + k; m.y[k] = 100000; m.age[k] = 0; }
  m.started = true; m.lx = -1e6; m.ly = -1e6; m.cd = 0;
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), MINE_CAP);
  for (let k = 0; k < MINE_CAP; k++) assert.equal(m.x[k], 100000 + k);
  assert.ok(m.cd <= 0); // not reset: it retries
});

test('an unarmed mine ignores a nearby enemy and detonates once it is armed', () => {
  const g = arenaGame();
  const j = at(g, 0, 0);
  run(g, 1, MINE_ARM - 0.15); // the mine drops at the end of the first update and ages after it
  assert.equal(damage(g, j), 0);
  assert.equal(liveMines(g), 1);
  run(g, 1, 0.4);
  assert.equal(liveMines(g), 0);
  assert.ok(damage(g, j) > 0);
});

test('a mine triggers inside 30 px plus the enemy radius, ignores a farther one, and its blast reaches the blast radius only', () => {
  const g = arenaGame();
  const farOnly = at(g, 30 + BR + 10, 0); // outside the trigger, inside the 60 px blast
  run(g, 1, 2);
  assert.equal(liveMines(g), 1); // armed, never triggered
  assert.equal(damage(g, farOnly), 0);
  const trigger = at(g, 30 + BR - 1, 0); // inside the trigger
  const edge = at(g, 0, MINE_LEVELS[0].radius + BR - 1); // inside the blast, outside the trigger
  const out = at(g, 0, MINE_LEVELS[0].radius + BR + 20); // outside the blast
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), 0);
  assert.ok(damage(g, trigger) > 0 && damage(g, edge) > 0 && damage(g, farOnly) > 0);
  assert.equal(damage(g, out), 0);
});

test('a blast deals exactly level damage times damageMult, crits, applies Frost and Ignite, and pushes outward with Knockback only', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.damageMult = 1; s.crit = 10; s.frost = 1; s.ignite = 1; s.knockback = 0;
  const j = at(g, 6, 0);
  const x0 = g.world.x[j];
  run(g, 1, 1);
  assert.equal(liveMines(g), 0);
  assert.ok(Math.abs(damage(g, j) - MINE_LEVELS[0].dmg * CRIT_MULT) < 1e-3); // crit 10 is chance 1: the blast crits
  assert.ok(g.world.slowT[j] > 0 && g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0); // no Knockback modifier, no push
  const g2 = arenaGame();
  g2.player.stats.knockback = 3;
  const k = at(g2, 6, 0);
  const x1 = g2.world.x[k];
  run(g2, 1, 1);
  assert.ok(g2.world.x[k] > x1); // pushed away from the mine (+x)
});

test('a detonated mine is consumed: it cannot hit again, and a stationary player drops no replacement before the interval', () => {
  const g = arenaGame();
  const j = at(g, 0, 0);
  run(g, 1, 1);
  const d = damage(g, j);
  assert.ok(d > 0);
  run(g, 1, 1);
  assert.equal(damage(g, j), d);
  assert.equal(liveMines(g), 0);
});

test('a mine expires after MINE_LIFE without detonating', () => {
  const g = arenaGame();
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), 1);
  run(g, 1, MINE_LIFE - 0.5);
  assert.equal(liveMines(g), 1);
  const kills = run(g, 1, 1);
  assert.equal(liveMines(g), 0);
  assert.equal(kills, 0);
});

test('a mine kill counts once, heals and queues an explosion; over a crowd kills equal onKill calls with no double kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  const j = at(g, 0, 0);
  g.world.hp[j] = 0.001;
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  const kills = run(g, 1, 1);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x + (n % 8) * 3, g2.player.y + Math.floor(n / 8) * 3);
    g2.world.hp[e] = 0.01;
  }
  const seen: number[] = [];
  const orig = g2.onKill!; // keep the arena's own onKill so splitters split
  g2.onKill = (x) => {
    seen.push(g2.world.gen[x] * 100000 + x);
    orig(x);
  };
  const k2 = run(g2, 5, 1);
  let swarmers = 0;
  for (let i = 0; i < g2.world.high; i++) if (g2.world.kind[i] === KIND.ENEMY && g2.world.type[i] === ENEMY.SWARMER) swarmers++;
  assert.ok(swarmers > 0, 'splitters split, so swarmers appeared');
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('stateHash changes with a mine age, a mine position and the drop point', () => {
  const g = arenaGame();
  settle(g);
  const empty = stateHash(g);
  updateMines(g, 1, 1 / 60);
  const dropped = stateHash(g);
  assert.notEqual(dropped, empty);
  const m = g.wstate.mines;
  const k = m.on.indexOf(1);
  m.age[k] += 0.5;
  assert.notEqual(stateHash(g), dropped);
  m.age[k] -= 0.5;
  m.x[k] += 1;
  assert.notEqual(stateHash(g), dropped);
  m.x[k] -= 1;
  m.lx += 1;
  assert.notEqual(stateHash(g), dropped);
});

test('Mines is a levelled arena-only weapon offer that takes a slot, with an icon', () => {
  const mines = SKILLS.find((k) => k.id === 'mines')!;
  assert.ok(mines.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'mines'));
  const s = baseStats();
  assert.equal(mines.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) applySkill(s, 'mines');
  assert.equal(s.weapons.mines, 5);
  assert.equal(mines.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 }; // the bow plus four fill the five slots
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS);
  assert.equal(mines.available!(full), false);
});

const pending = (g: Game) => g.wstate.meteors.on.reduce((n, v) => n + v, 0);
const runM = (g: Game, level: number, secs: number) => {
  let kills = 0;
  for (let t = 0; t < Math.round(secs * 60); t++) { settle(g); kills += updateMeteors(g, level, 1 / 60); }
  return kills;
};
const firstPick = (g: Game) => { g.rng = () => 0; };

test('meteor fires only at enemies within range, never at one outside, and draws no rng with nothing in range', () => {
  const g = arenaGame();
  let draws = 0;
  g.rng = () => { draws++; return 0; };
  at(g, METEOR_RANGE + 5, 0); // outside the range but inside the grid query (range + max radius), so only the range check rejects it
  runM(g, 1, 1 / 60);
  assert.equal(pending(g), 0);
  assert.equal(draws, 0);
  assert.ok(g.wstate.meteors.cd <= 0); // not reset: retries
  const near = at(g, METEOR_RANGE - 20, 0);
  runM(g, 1, 1 / 60);
  assert.equal(pending(g), 1);
  assert.equal(draws, 1);
  const m = g.wstate.meteors;
  const k = m.on.indexOf(1);
  assert.ok(Math.abs(m.x[k] - g.world.x[near]) < 1e-3);
  assert.ok(g.wstate.meteors.cd > 0);
});

test('a volley picks distinct targets and strikes only as many as there are candidates', () => {
  const g = arenaGame();
  firstPick(g);
  at(g, 100, 0);
  at(g, -100, 0);
  runM(g, 5, 1 / 60); // volley of 3, two candidates
  assert.equal(pending(g), 2);
  const m = g.wstate.meteors;
  const xs = [0, 1, 2].filter((k) => m.on[k]).map((k) => m.x[k]);
  assert.notEqual(xs[0], xs[1]);
  const g3 = arenaGame();
  firstPick(g3);
  at(g3, 100, 0); at(g3, -100, 0); at(g3, 0, 100); at(g3, 0, -100);
  runM(g3, 5, 1 / 60);
  assert.equal(pending(g3), 3);
  const m3 = g3.wstate.meteors;
  const pts = Array.from(m3.on.keys()).filter((k) => m3.on[k]).map((k) => `${m3.x[k]},${m3.y[k]}`);
  assert.equal(new Set(pts).size, 3);
});

test('a strike keeps the position the target had when it was picked, even if the target moves or dies', () => {
  const g = arenaGame();
  firstPick(g);
  const j = at(g, 100, 0);
  const x0 = g.world.x[j];
  runM(g, 1, 1 / 60);
  const m = g.wstate.meteors;
  const k = m.on.indexOf(1);
  g.world.x[j] += 200;
  g.world.hp[j] = 0.001; // dies of anything
  const bystander = at(g, 100 + 1, 0); // standing at the old spot when it lands
  runM(g, 1, METEOR_TELEGRAPH + 0.05);
  assert.equal(m.on[k], 0);
  assert.ok(damage(g, bystander) > 0);
  assert.equal(Math.round(m.x[k]), Math.round(x0)); // the stored spot did not follow the target
});

test('nothing lands before the telegraph ends, and the strike is consumed once it does', () => {
  const g = arenaGame();
  firstPick(g);
  const j = at(g, 100, 0);
  runM(g, 1, 1 / 60);
  runM(g, 1, METEOR_TELEGRAPH - 0.1);
  assert.equal(damage(g, j), 0);
  assert.equal(pending(g), 1);
  runM(g, 1, 0.2);
  assert.equal(pending(g), 0);
  const d = damage(g, j);
  assert.ok(d > 0);
  runM(g, 1, 0.3); // the next volley is seconds away: no second hit
  assert.equal(damage(g, j), d);
});

test('a blast deals exactly level damage times damageMult, crits, reaches the radius only, applies Frost and Ignite, and pushes with Knockback only', () => {
  const g = arenaGame();
  firstPick(g);
  const s = g.player.stats;
  s.damageMult = 1; s.crit = 10; s.frost = 1; s.ignite = 1; s.knockback = 0;
  const L = METEOR_LEVELS[0];
  const BR = ENEMY_TYPES[ENEMY.BRUISER].radius;
  const j = at(g, 100, 0); // the only candidate in range: picked first
  const edge = at(g, 100, L.radius + BR - 1);
  const out = at(g, 100, L.radius + BR + 20);
  const x0 = g.world.x[j];
  runM(g, 1, 1 / 60 + METEOR_TELEGRAPH + 0.05);
  assert.ok(Math.abs(damage(g, j) - L.dmg * CRIT_MULT) < 1e-3); // crit 10 is chance 1: the blast crits
  assert.ok(damage(g, edge) > 0);
  assert.equal(damage(g, out), 0);
  assert.ok(g.world.slowT[j] > 0 && g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0);
  const g2 = arenaGame();
  firstPick(g2);
  g2.player.stats.knockback = 3;
  const k = at(g2, 100, 0);
  const e = at(g2, 100 + 10, 0);
  const x1 = g2.world.x[e];
  runM(g2, 1, 1 / 60 + METEOR_TELEGRAPH + 0.05);
  assert.ok(g2.world.x[e] > x1); // pushed away from the impact point (+x)
  assert.ok(damage(g2, k) > 0);
});

test('the same seed picks the same targets', () => {
  const pick = () => {
    const g = arenaGame();
    for (let n = 0; n < 12; n++) at(g, 60 + n * 15, (n % 3) * 20);
    runM(g, 5, 1 / 60);
    const m = g.wstate.meteors;
    return Array.from(m.on.keys()).filter((k) => m.on[k]).map((k) => [m.x[k], m.y[k]]);
  };
  assert.deepEqual(pick(), pick());
});

test('a full pool skips the strike without overwriting a pending one', () => {
  const g = arenaGame();
  firstPick(g);
  const m = g.wstate.meteors;
  for (let k = 0; k < METEOR_CAP; k++) { m.on[k] = 1; m.x[k] = 100000 + k; m.y[k] = 100000; m.age[k] = 0; }
  at(g, 100, 0);
  runM(g, 1, 1 / 60);
  assert.equal(pending(g), METEOR_CAP);
  for (let k = 0; k < METEOR_CAP; k++) assert.equal(m.x[k], 100000 + k);
  assert.ok(m.cd > 0); // the volley still fired
});

test('a meteor kill counts once, heals and queues an explosion; over a crowd kills equal onKill calls, splitters split, no double kill', () => {
  const g = arenaGame();
  firstPick(g);
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  const j = at(g, 100, 0);
  g.world.hp[j] = 0.001;
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  const kills = runM(g, 1, 1 / 60 + METEOR_TELEGRAPH + 0.05);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  firstPick(g2);
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x + 100 + (n % 8) * 3, g2.player.y + Math.floor(n / 8) * 3);
    g2.world.hp[e] = 0.01;
  }
  const seen: number[] = [];
  const orig = g2.onKill!; // keep the arena's own onKill so splitters split
  g2.onKill = (x) => { seen.push(g2.world.gen[x] * 100000 + x); orig(x); };
  const k2 = runM(g2, 5, 1 / 60 + METEOR_TELEGRAPH + 0.05);
  let swarmers = 0;
  for (let i = 0; i < g2.world.high; i++) if (g2.world.kind[i] === KIND.ENEMY && g2.world.type[i] === ENEMY.SWARMER) swarmers++;
  assert.ok(swarmers > 0, 'splitters split');
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('stateHash changes with a strike age, a strike position and the fire timer', () => {
  const g = arenaGame();
  firstPick(g);
  at(g, 100, 0);
  settle(g);
  const empty = stateHash(g);
  updateMeteors(g, 1, 1 / 60);
  const fired = stateHash(g);
  assert.notEqual(fired, empty);
  const m = g.wstate.meteors;
  const k = m.on.indexOf(1);
  m.age[k] += 0.1;
  assert.notEqual(stateHash(g), fired);
  m.age[k] -= 0.1;
  m.x[k] += 1;
  assert.notEqual(stateHash(g), fired);
  m.x[k] -= 1;
  m.cd += 1;
  assert.notEqual(stateHash(g), fired);
});

test('Meteor is a levelled arena-only weapon offer that takes a slot, with an icon', () => {
  const meteor = SKILLS.find((k) => k.id === 'meteor')!;
  assert.ok(meteor.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'meteor'));
  const s = baseStats();
  assert.equal(meteor.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) applySkill(s, 'meteor');
  assert.equal(s.weapons.meteor, 5);
  assert.equal(meteor.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 };
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS);
  assert.equal(meteor.available!(full), false);
});

const runB = (g: Game, level: number, secs: number) => {
  let kills = 0;
  for (let t = 0; t < Math.round(secs * 60); t++) { settle(g); kills += updateBeam(g, level, 1 / 60); }
  return kills;
};
const hp = (g: Game, j: number) => g.world.hp[j];

test('the first update with a target snaps the beam to it; with no target nothing changes and live is 0', () => {
  const g = arenaGame();
  const b = g.wstate.beam;
  runB(g, 1, 1 / 60);
  assert.equal(b.live, 0);
  assert.equal(b.started, 0);
  assert.equal(b.cd, 0);
  at(g, 0, 100); // straight down (+y)
  runB(g, 1, 1 / 60);
  assert.equal(b.live, 1);
  assert.equal(b.started, 1);
  assert.ok(Math.abs(b.angle - Math.PI / 2) < 1e-6);
  g.world.kind.fill(0); // all enemies gone: the beam goes off but keeps its heading and timer
  const cd = b.cd, angle = b.angle;
  runB(g, 1, 0.5);
  assert.equal(b.live, 0);
  assert.equal(b.angle, angle);
  assert.equal(b.cd, cd);
});

test('after the snap the beam turns at most turn * dt per tick toward the target, by the shorter arc, and stays capped when the nearest changes', () => {
  const g = arenaGame();
  const b = g.wstate.beam;
  const L = BEAM_LEVELS[0];
  const first = at(g, 100, 0); // +x, angle 0
  runB(g, 1, 1 / 60);
  assert.equal(b.angle, 0);
  g.world.x[first] = g.player.x; g.world.y[first] = g.player.y + 100; // the target jumps to +y (π/2 away)
  const before = b.angle;
  runB(g, 1, 1 / 60);
  assert.ok(Math.abs(b.angle - before - L.turn / 60) < 1e-6); // exactly one capped step, toward +y
  runB(g, 1, 1.4);
  assert.ok(Math.abs(b.angle - Math.PI / 2) < 1e-6); // arrived (π/2 / 1.2 = 1.31 s of turning needed after the snap tick, 1.4 s + 1 tick done) and did not overshoot
  const g2 = arenaGame();
  const b2 = g2.wstate.beam;
  const t2 = at(g2, -100, 0); // behind: angle π
  runB(g2, 1, 1 / 60);
  assert.ok(Math.abs(Math.abs(b2.angle) - Math.PI) < 1e-6);
  g2.world.x[t2] = g2.player.x - 100; g2.world.y[t2] = g2.player.y - 100; // up-left: angle -3π/4, a short arc across ±π
  runB(g2, 1, 1 / 60);
  assert.ok(Math.abs(b2.angle) > Math.PI - L.turn / 60 - 1e-6); // moved by one capped step across the seam, not the long way round
  runB(g2, 1, 2);
  assert.ok(Math.abs(b2.angle - (-3 * Math.PI / 4)) < 1e-6);
});

test('a target must be within the beam length; a nearer enemy outside never counts', () => {
  const g = arenaGame();
  const b = g.wstate.beam;
  const L = BEAM_LEVELS[0];
  at(g, L.length + 5, 0);
  runB(g, 1, 1 / 60);
  assert.equal(b.live, 0);
  at(g, L.length - 5, 0);
  runB(g, 1, 1 / 60);
  assert.equal(b.live, 1);
});

test('the beam hits enemies on the segment and nothing off it, past the end, or behind the player', () => {
  const g = arenaGame();
  const L = BEAM_LEVELS[0];
  const BR = ENEMY_TYPES[ENEMY.BRUISER].radius;
  const on = at(g, 15, 0); // the nearest enemy, so the target, on the line
  const justIn = at(g, 60, L.halfWidth + BR - 1);
  const justOut = at(g, 60, L.halfWidth + BR + 2);
  const behind = at(g, -60, 0);
  const SW = ENEMY_TYPES[ENEMY.SWARMER];
  const behindNear = spawnEnemy(g.world, ENEMY.SWARMER, g.player.x - 18, g.player.y); // gathered (same cells) but 18 > halfWidth + 7 from the player: only the segment clamp keeps it out
  const past = at(g, L.length + L.halfWidth + BR + 5, 0);
  runB(g, 1, 1 / 60); // snap, first tick
  const dmg = (j: number) => BRUISER_HP - hp(g, j);
  assert.ok(dmg(on) > 0);
  assert.ok(dmg(justIn) > 0);
  assert.equal(dmg(justOut), 0);
  assert.equal(dmg(behind), 0);
  assert.equal(SW.hp - hp(g, behindNear), 0);
  assert.equal(dmg(past), 0);
});

test('the beam ticks every 0.25 s and no more often, for exactly dps * 0.25 * damageMult, never crits or pushes, and applies Frost and Ignite', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.damageMult = 2; s.crit = 10; s.frost = 1; s.ignite = 1; s.knockback = 3;
  const j = at(g, 100, 0);
  const x0 = g.world.x[j];
  runB(g, 1, 1 / 60);
  const d1 = BRUISER_HP - hp(g, j);
  assert.ok(Math.abs(d1 - BEAM_LEVELS[0].dps * BEAM_TICK * 2) < 1e-3); // crit 10 is chance 1: a crit flag would show
  runB(g, 1, BEAM_TICK - 0.05); // not yet due again
  assert.equal(BRUISER_HP - hp(g, j), d1);
  runB(g, 1, 0.1);
  assert.ok(Math.abs(BRUISER_HP - hp(g, j) - 2 * d1) < 1e-3);
  assert.ok(g.world.slowT[j] > 0 && g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0); // no push even with Knockback
});

test('beam ticks are quiet: every surviving hit tells fx.soft', () => {
  const g = arenaGame();
  const soft: Array<[number, number]> = [];
  g.fx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: (j, d) => soft.push([j, d]) };
  const j = at(g, 100, 0);
  runB(g, 1, 1 / 60);
  assert.deepEqual(soft, [[j, BEAM_LEVELS[0].dps * BEAM_TICK * g.player.stats.damageMult]]);
});

test('a beam kill counts once, heals and queues an explosion; over a crowd kills equal onKill calls, splitters split, no double kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  const j = at(g, 100, 0);
  g.world.hp[j] = 0.001;
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  const kills = runB(g, 1, 1 / 60);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x + 40 + (n % 8) * 12, g2.player.y + ((n % 3) - 1) * 3);
    g2.world.hp[e] = 0.01;
  }
  const seen: number[] = [];
  const orig = g2.onKill!;
  g2.onKill = (x) => { seen.push(g2.world.gen[x] * 100000 + x); orig(x); };
  const k2 = runB(g2, 5, 1 / 60);
  let swarmers = 0;
  for (let i = 0; i < g2.world.high; i++) if (g2.world.kind[i] === KIND.ENEMY && g2.world.type[i] === ENEMY.SWARMER) swarmers++;
  assert.ok(k2 > 0 && swarmers > 0, 'enemies died and splitters split');
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('stateHash changes with the beam angle, live, started and the tick timer', () => {
  const g = arenaGame();
  at(g, 100, 0);
  settle(g);
  const empty = stateHash(g);
  updateBeam(g, 1, 1 / 60);
  const b = g.wstate.beam;
  const on = stateHash(g);
  assert.notEqual(on, empty);
  b.angle += 0.1;
  assert.notEqual(stateHash(g), on);
  b.angle -= 0.1;
  b.cd += 0.1;
  assert.notEqual(stateHash(g), on);
  b.cd -= 0.1;
  b.live = 0;
  assert.notEqual(stateHash(g), on);
  b.live = 1;
  b.started = 0;
  assert.notEqual(stateHash(g), on);
});

test('Beam is a levelled arena-only weapon offer that takes a slot, with an icon', () => {
  const beam = SKILLS.find((k) => k.id === 'beam')!;
  assert.ok(beam.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'beam'));
  const s = baseStats();
  assert.equal(beam.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) applySkill(s, 'beam');
  assert.equal(s.weapons.beam, 5);
  assert.equal(beam.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 };
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS);
  assert.equal(beam.available!(full), false);
  assert.ok(!SKILLS.filter((k) => !k.arena).some((k) => k.id === 'beam')); // the Rooms pool is unchanged
});

const runD = (g: Game, level: number, secs: number) => {
  let kills = 0;
  for (let t = 0; t < Math.round(secs * 60); t++) { settle(g); kills += updateDrone(g, level, 1 / 60); }
  return kills;
};
const tough = (g: Game, j: number) => { g.world.hp[j] = 1e6; return j; }; // a target that survives every shot
const lost = (g: Game, j: number) => 1e6 - g.world.hp[j];

test('a drone snaps to its offset on activation, then eases toward it without overshoot and lags a moving player', () => {
  const g = arenaGame();
  const d = g.wstate.drones;
  runD(g, 1, 1 / 60);
  assert.equal(d.on[0], 1);
  assert.equal(d.on[1], 0);
  assert.ok(Math.abs(d.x[0] - (g.player.x + DRONE_OFFSETS[0][0])) < 1e-3);
  assert.ok(Math.abs(d.y[0] - (g.player.y + DRONE_OFFSETS[0][1])) < 1e-3);
  const x0 = d.x[0];
  g.player.x += 100; // the target jumps 100 px: one update closes min(1, 6/60) = 10% of the gap
  runD(g, 1, 1 / 60);
  assert.ok(Math.abs(d.x[0] - (x0 + 10)) < 1e-3);
  const tx = g.player.x + DRONE_OFFSETS[0][0];
  for (let t = 0; t < 300; t++) { runD(g, 1, 1 / 60); assert.ok(d.x[0] <= tx + 1e-3); } // never past the target
  assert.ok(Math.abs(d.x[0] - tx) < 1e-3); // converged
});

test('range is measured from the drone: one the drone reaches but the player cannot is shot, one the player reaches but the drone cannot is not', () => {
  const L = DRONE_LEVELS[0];
  const g = arenaGame();
  const a = tough(g, at(g, -242, -32)); // 210 px from the drone at (-32, -32), about 244 from the player
  runD(g, 1, 1 / 60);
  assert.ok(Math.abs(lost(g, a) - L.dmg * g.player.stats.damageMult) < 1e-3);
  const g2 = arenaGame();
  const b = tough(g2, at(g2, 190, 0)); // 190 px from the player, about 224 from the drone (range 220)
  runD(g2, 1, 1 / 60);
  assert.equal(lost(g2, b), 0);
});

test('with no target nothing fires and the timer holds at 0; the first update with a target fires', () => {
  const g = arenaGame();
  const d = g.wstate.drones;
  runD(g, 1, 1);
  assert.equal(d.cd[0], 0);
  assert.equal(d.age[0], Math.fround(DRONE_TRACER)); // no tracer yet
  const j = tough(g, at(g, -100, -32));
  runD(g, 1, 1 / 60);
  assert.ok(lost(g, j) > 0);
});

test('a shot is exactly dmg * damageMult at crit 0, crits at crit chance 1, never pushes, and applies Frost and Ignite', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.damageMult = 2; s.frost = 1; s.ignite = 1; s.knockback = 3;
  const j = tough(g, at(g, -132, -32));
  const x0 = g.world.x[j];
  runD(g, 1, 1 / 60);
  assert.ok(Math.abs(lost(g, j) - DRONE_LEVELS[0].dmg * 2) < 1e-3);
  assert.ok(g.world.slowT[j] > 0 && g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0); // no push even with Knockback
  const g2 = arenaGame();
  g2.player.stats.crit = 1000; // chance 1
  const k = tough(g2, at(g2, -132, -32));
  runD(g2, 1, 1 / 60);
  assert.ok(lost(g2, k) > DRONE_LEVELS[0].dmg * g2.player.stats.damageMult);
});

test('a drone shoots once per interval, not more often, and the second drone fires a little later than the first', () => {
  const g = arenaGame();
  const j = tough(g, at(g, -100, -32));
  runD(g, 1, 1 / 60); // first shot on the activation update
  const one = lost(g, j);
  runD(g, 1, 0.5); // 0.5167 s since the first update: not yet due again (interval 0.6)
  assert.equal(lost(g, j), one);
  runD(g, 1, 0.2); // 0.7167 s: the second shot has landed, a third is not due before 1.2 s
  assert.ok(Math.abs(lost(g, j) - 2 * one) < 1e-3);
  const g2 = arenaGame();
  const e = tough(g2, at(g2, 0, -100)); // within range of both level-3 drones
  const dmg = DRONE_LEVELS[2].dmg * g2.player.stats.damageMult;
  runD(g2, 3, 1 / 60);
  assert.ok(Math.abs(lost(g2, e) - dmg) < 1e-3); // only slot 0 has fired
  runD(g2, 3, 0.1); // 0.1167 s: slot 1 (stagger 0.15 s) is still waiting
  assert.ok(Math.abs(lost(g2, e) - dmg) < 1e-3);
  runD(g2, 3, 0.2); // 0.3167 s: slot 1 has fired, slot 0 (interval 0.5) has not yet
  assert.ok(Math.abs(lost(g2, e) - 2 * dmg) < 1e-3);
});

test('a shot sets the tracer to the target and age 0; age advances and caps at DRONE_TRACER; droneAlpha fades from 1 to 0', () => {
  const g = arenaGame();
  const d = g.wstate.drones;
  const j = tough(g, at(g, -100, -32));
  runD(g, 1, 1 / 60);
  assert.equal(d.age[0], 0);
  assert.ok(Math.abs(d.tx[0] - g.world.x[j]) < 1e-3 && Math.abs(d.ty[0] - g.world.y[j]) < 1e-3);
  runD(g, 1, 1 / 60);
  assert.ok(Math.abs(d.age[0] - 1 / 60) < 1e-6);
  runD(g, 1, 0.3); // still before the second shot at 0.6 s
  assert.equal(d.age[0], Math.fround(DRONE_TRACER));
  assert.equal(droneAlpha(0), 1);
  assert.ok(Math.abs(droneAlpha(DRONE_TRACER / 2) - 0.5) < 1e-9);
  assert.equal(droneAlpha(DRONE_TRACER), 0);
  assert.equal(droneAlpha(DRONE_TRACER * 2), 0);
});

test('a drone kill counts once, heals and queues an explosion; over a crowd kills equal onKill calls, splitters split, no double kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  const j = at(g, -100, -32);
  g.world.hp[j] = 0.001;
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  const kills = runD(g, 1, 1 / 60);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x - 40 - (n % 8) * 12, g2.player.y - 32 + ((n % 3) - 1) * 3);
    g2.world.hp[e] = 0.01;
  }
  const seen: number[] = [];
  let maxSwarm = 0; // the most swarmers alive at once: the drones kill the nearest enemy first, so children can die before the end
  const orig = g2.onKill!;
  g2.onKill = (x) => {
    seen.push(g2.world.gen[x] * 100000 + x);
    orig(x);
    let n = 0;
    for (let i = 0; i < g2.world.high; i++) if (g2.world.kind[i] === KIND.ENEMY && g2.world.type[i] === ENEMY.SWARMER) n++;
    maxSwarm = Math.max(maxSwarm, n);
  };
  const k2 = runD(g2, 5, 1);
  assert.ok(k2 > 0 && maxSwarm > 0, 'enemies died and splitters split');
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('the active drone count follows the level and a level-up snaps only the new drone', () => {
  const g = arenaGame();
  const d = g.wstate.drones;
  const counts = (level: number) => { runD(g, level, 1 / 60); return Array.from(d.on).reduce((n, v) => n + v, 0); };
  assert.equal(counts(1), 1);
  assert.equal(counts(2), 1);
  g.player.x += 100;
  runD(g, 2, 1 / 60); // drone 0 eases: it is now behind its target
  const behind = d.x[0];
  assert.ok(behind < g.player.x + DRONE_OFFSETS[0][0] - 1);
  assert.equal(counts(3), 2);
  assert.ok(Math.abs(d.x[1] - (g.player.x + DRONE_OFFSETS[1][0])) < 1e-3); // the new drone is exactly on its target
  assert.ok(d.x[0] > behind); // the first kept easing, it was not snapped
  assert.ok(d.x[0] < g.player.x + DRONE_OFFSETS[0][0] - 1e-3);
  assert.equal(counts(5), 3);
});

test('stateHash changes with a drone position, its timer, its active flag and its tracer', () => {
  const g = arenaGame();
  at(g, -100, -32);
  settle(g);
  const empty = stateHash(g);
  updateDrone(g, 1, 1 / 60);
  const d = g.wstate.drones;
  const on = stateHash(g);
  assert.notEqual(on, empty);
  for (const f of ['x', 'y', 'cd', 'tx', 'ty', 'age'] as const) {
    d[f][0] += 1;
    assert.notEqual(stateHash(g), on, f);
    d[f][0] -= 1;
  }
  d.on[0] = 0;
  assert.notEqual(stateHash(g), on);
  d.on[0] = 1;
  d.on[2] = 1; // an inactive-by-level slot still changes the hash when its flag does
  assert.notEqual(stateHash(g), on);
});

test('Drone is a levelled arena-only weapon offer that takes a slot, with an icon', () => {
  const drone = SKILLS.find((k) => k.id === 'drone')!;
  assert.ok(drone.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'drone'));
  const s = baseStats();
  assert.equal(drone.tag!(s), 'NEW');
  for (let n = 0; n < 5; n++) applySkill(s, 'drone');
  assert.equal(s.weapons.drone, 5);
  assert.equal(drone.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 };
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS);
  assert.equal(drone.available!(full), false);
  assert.ok(!SKILLS.filter((k) => !k.arena).some((k) => k.id === 'drone')); // the Rooms pool is unchanged
});

test('a drone follows by at most the whole gap even in one long update (the follow factor is clamped at 1)', () => {
  const g = arenaGame();
  const d = g.wstate.drones;
  runD(g, 1, 1 / 60);
  g.player.x += 100;
  settle(g);
  updateDrone(g, 1, 0.5); // unclamped, 6 * 0.5 = 3 would throw the drone 200 px past its target
  assert.ok(Math.abs(d.x[0] - (g.player.x + DRONE_OFFSETS[0][0])) < 1e-3);
});

test('a drone shot is a full hit, not a quiet tick: it never tells fx.soft', () => {
  const g = arenaGame();
  const soft: number[] = [];
  g.fx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: (j) => soft.push(j) };
  tough(g, at(g, -100, -32));
  runD(g, 1, 1 / 60);
  assert.deepEqual(soft, []);
});

test('Rapid Fire (cooldownMult) scales the Mines drop interval', () => {
  const g = arenaGame();
  g.player.stats.cooldownMult = 0.5;
  run(g, 1, 1 / 60);
  assert.equal(liveMines(g), 1);
  assert.ok(Math.abs(g.wstate.mines.cd - MINE_LEVELS[0].interval * 0.5) < 1e-9);
});

test('Rapid Fire (cooldownMult) scales the Meteor volley interval', () => {
  const g = arenaGame();
  g.player.stats.cooldownMult = 0.5;
  at(g, METEOR_RANGE - 20, 0);
  runM(g, 1, 1 / 60);
  assert.equal(pending(g), 1);
  assert.ok(Math.abs(g.wstate.meteors.cd - METEOR_LEVELS[0].interval * 0.5) < 1e-9);
});

test('Rapid Fire (cooldownMult) scales the Drone shot interval', () => {
  const g = arenaGame();
  g.player.stats.cooldownMult = 0.5;
  tough(g, at(g, -100, -32));
  runD(g, 1, 1 / 60); // first shot on the activation update
  assert.ok(Math.abs(g.wstate.drones.cd[0] - DRONE_LEVELS[0].interval * 0.5) < 1e-6); // cd is a Float32Array
});

const runK = (g: Game, level: number, updates: number) => {
  let kills = 0;
  for (let t = 0; t < updates; t++) { settle(g); kills += updateDaggers(g, level, 1 / 60); }
  return kills;
};
const liveK = (g: Game) => g.wstate.daggers.on.reduce((n, v) => n + v, 0);
const angleK = (g: Game, k: number) => Math.atan2(g.wstate.daggers.dy[k], g.wstate.daggers.dx[k]);
const STEP = DAGGER_SPEED / 60; // 11.667 px per update

test('moving, the fan is centred on the velocity direction even with an enemy elsewhere', () => {
  const g = arenaGame();
  at(g, -100, 0); // behind the player: the nearest enemy must not steer a moving volley
  g.player.vx = 300; g.player.vy = 400; // speed 500 > DAGGER_MOVE_MIN
  runK(g, 1, 1);
  assert.equal(liveK(g), 3);
  assert.ok(Math.abs(angleK(g, 1) - Math.atan2(400, 300)) < 1e-5); // centre dagger, 0.9273 rad
});

test('standing still (or slower than DAGGER_MOVE_MIN, or exactly at it), the fan is centred on the nearest enemy', () => {
  const aimAt = -Math.atan2(160, 120); // enemy at (120, -160): -0.9273 rad, 200 px away (range 320)
  for (const vx of [0, 15, 20]) { // 20 is not > 20, so it counts as still
    const g = arenaGame();
    at(g, 120, -160);
    g.player.vx = vx;
    runK(g, 1, 1);
    assert.equal(liveK(g), 3, `vx ${vx}`);
    assert.ok(Math.abs(angleK(g, 1) - aimAt) < 1e-5, `vx ${vx}`);
  }
});

test('an enemy within 1e-6 px of a still player aims the fan along +x', () => {
  const g = arenaGame();
  g.player.x = 4; g.player.y = 4; // small coordinates, where float32 can hold an offset below 1e-6
  const j = spawnEnemy(g.world, ENEMY.BRUISER, 4, 4 + 5e-7);
  const off = g.world.y[j] - 4;
  assert.ok(off > 0 && off < 1e-6, 'the stored offset is nonzero and under 1e-6'); // one float32 step, 4.77e-7
  runK(g, 1, 1);
  assert.equal(liveK(g), 3);
  assert.ok(Math.abs(angleK(g, 1)) < 1e-6); // without the fallback atan2 would give PI / 2
});

test('the volley timer: no aim launches nothing and holds cd at 0, the first update with an aim fires, the next volley waits the interval', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  runK(g, 1, 60); // still, no enemy: no aim
  assert.equal(liveK(g), 0);
  assert.equal(d.cd, 0);
  g.player.vx = 300;
  runK(g, 1, 1); // update 1 of the volley: launch
  assert.equal(liveK(g), 3);
  assert.equal(d.cd, DAGGER_LEVELS[0].interval);
  runK(g, 1, 54); // update 55: the volley was freed at update 29; cd = 1 - 54/60 = 0.1 > 0, no new volley
  assert.equal(liveK(g), 0);
  runK(g, 1, 15); // update 70: the second volley launched at update 61 (or 62 on float residue) and flies until 89 (or 90)
  assert.equal(liveK(g), 3);
});

test('the fan has the level count, is symmetric about the aim, and neighbours are DAGGER_SPREAD apart', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  g.player.vx = 300; g.player.vy = 400;
  const aim = Math.atan2(400, 300);
  runK(g, 5, 1);
  assert.equal(liveK(g), 7);
  for (let k = 0; k < 7; k++) { // 0.3873, 0.5673, ..., 1.4673 rad: no wrap
    assert.ok(Math.abs(angleK(g, k) - (aim + (k - 3) * DAGGER_SPREAD)) < 1e-5, `dagger ${k}`);
    assert.ok(Math.abs(Math.hypot(d.dx[k], d.dy[k]) - 1) < 1e-6);
  }
});

test('a dagger moves from the next update, flies DAGGER_SPEED px/s and is freed once it has flown its range', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  const L = DAGGER_LEVELS[0];
  g.player.vx = 300; // aim +x
  const px = g.player.x;
  const py = g.player.y;
  runK(g, 1, 1); // launch
  assert.equal(d.x[1], px); // not moved on its launch update (1500 and 1920 are float32-exact)
  assert.equal(d.y[1], py);
  assert.equal(d.left[1], L.range); // 320 is float32-exact
  runK(g, 1, 1);
  assert.ok(Math.abs(d.x[1] - (px + STEP)) < 1e-3);
  assert.ok(Math.abs(d.y[1] - py) < 1e-3);
  assert.ok(Math.abs(d.left[1] - (L.range - STEP)) < 1e-3);
  runK(g, 1, 26); // update 28: 27 moves, 315 px flown, left 5
  assert.equal(liveK(g), 3);
  assert.ok(Math.abs(d.x[1] - (px + 27 * STEP)) < 5e-3); // float32 positions near 1500 round by up to 6e-5 per move
  assert.ok(Math.abs(d.left[1] - (L.range - 27 * STEP)) < 1e-3);
  for (const k of [0, 2]) assert.ok(Math.abs(Math.hypot(d.x[k] - px, d.y[k] - py) - 27 * STEP) < 5e-3); // the side daggers fly as fast
  runK(g, 1, 1); // the 28th move takes left to 320 - 326.7 < 0: freed
  assert.equal(liveK(g), 0);
});

test('a dagger hit deals exactly dmg * damageMult at crit 0', () => {
  const g = arenaGame();
  g.player.stats.damageMult = 2;
  g.player.vx = 300;
  const j = tough(g, at(g, 200, 0)); // centre path; the side daggers pass 35.8 px away (> 24)
  runK(g, 1, 30); // the whole flight
  assert.ok(Math.abs(lost(g, j) - DAGGER_LEVELS[0].dmg * 2) < 1e-3);
});

test('a dagger hits an enemy once per pass: it skips the enemy it last hit while still overlapping it', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  g.player.vx = 300;
  const j = tough(g, at(g, 200, 0)); // the centre dagger overlaps it on moves 16 to 19 (x = 186.7 to 221.7, |dx| <= 24)
  runK(g, 1, 25); // 24 moves: x = 280, past it, left 40
  assert.ok(Math.abs(lost(g, j) - DAGGER_LEVELS[0].dmg) < 1e-3);
  assert.equal(d.on[1], 1);
  assert.equal(d.pierce[1], 0); // one pierce spent
  assert.equal(d.lastHit[1], j);
  assert.equal(d.lastGen[1], g.world.gen[j]);
});

test('a dagger spends one pierce per hit and is freed on its (pierce + 1)th hit', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  g.player.vx = 300;
  const a = tough(g, at(g, 150, 0)); // first hit on move 11 (x = 128.3); still overlapping on 12-14, skipped
  const b = tough(g, at(g, 200, 0)); // second hit on move 16 (x = 186.7; move 15 at 175 is 25 px from both): level-1 pierce 1 is spent, freed
  const c = tough(g, at(g, 250, 0)); // a live centre dagger would reach it on move 20 (x = 233.3)
  runK(g, 1, 12); // 11 moves
  assert.equal(d.pierce[1], 0);
  assert.equal(d.on[1], 1);
  runK(g, 1, 18); // 30 updates in all; cd (1.0 s) keeps the slot from being reused
  const dmg = DAGGER_LEVELS[0].dmg;
  assert.ok(Math.abs(lost(g, a) - dmg) < 1e-3);
  assert.ok(Math.abs(lost(g, b) - dmg) < 1e-3);
  assert.equal(lost(g, c), 0);
  assert.equal(d.on[1], 0);
});

test('a dagger hit crits at crit chance 1, applies Frost and Ignite, and never pushes even with Knockback', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.frost = 1; s.ignite = 1; s.knockback = 3;
  g.player.vx = 300;
  const j = tough(g, at(g, 200, 0));
  const x0 = g.world.x[j];
  const y0 = g.world.y[j];
  runK(g, 1, 30);
  assert.ok(lost(g, j) > 0);
  assert.ok(g.world.slowT[j] > 0 && g.world.burnT[j] > 0);
  assert.equal(g.world.x[j], x0); // no push
  assert.equal(g.world.y[j], y0);
  const g2 = arenaGame();
  g2.player.stats.crit = 1000; // chance 1
  g2.player.vx = 300;
  const k = tough(g2, at(g2, 200, 0));
  runK(g2, 1, 30);
  assert.ok(lost(g2, k) > DAGGER_LEVELS[0].dmg * g2.player.stats.damageMult);
});

test('a dagger hit is a full hit, not a quiet tick: it never tells fx.soft', () => {
  const g = arenaGame();
  const soft: number[] = [];
  g.fx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: (j) => soft.push(j) };
  g.player.vx = 300;
  const j = tough(g, at(g, 200, 0));
  runK(g, 1, 30);
  assert.ok(lost(g, j) > 0);
  assert.deepEqual(soft, []);
});

test('Rapid Fire (cooldownMult) scales the Daggers volley interval', () => {
  const g = arenaGame();
  g.player.stats.cooldownMult = 0.5;
  g.player.vx = 300;
  runK(g, 1, 1);
  assert.equal(liveK(g), 3);
  assert.ok(Math.abs(g.wstate.daggers.cd - DAGGER_LEVELS[0].interval * 0.5) < 1e-9); // cd is a plain number
});

test('a dagger kill counts once, heals and queues an explosion; over a crowd kills equal onKill calls, splitters split, no double kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 2;
  g.player.stats.explode = 1;
  g.player.hp = g.player.maxHp - 10;
  g.player.vx = 300;
  const j = at(g, 200, 0);
  g.world.hp[j] = 0.001;
  const killed: number[] = [];
  g.onKill = (x) => killed.push(g.world.gen[x] * 100000 + x);
  const kills = runK(g, 1, 30);
  assert.equal(kills, 1);
  assert.equal(killed.length, 1);
  assert.equal(g.player.hp, g.player.maxHp - 8);
  assert.equal(g.blasts.n, 1);
  const g2 = arenaGame();
  g2.player.vx = 300;
  for (let n = 0; n < 40; n++) {
    const e = spawnEnemy(g2.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g2.player.x + 40 + (n % 8) * 12, g2.player.y + ((n % 3) - 1) * 3);
    g2.world.hp[e] = 0.01;
  }
  const seen: number[] = [];
  let maxSwarm = 0; // the most swarmers alive at once: children can die again before the end
  const orig = g2.onKill!;
  g2.onKill = (x) => {
    seen.push(g2.world.gen[x] * 100000 + x);
    orig(x);
    let n = 0;
    for (let i = 0; i < g2.world.high; i++) if (g2.world.kind[i] === KIND.ENEMY && g2.world.type[i] === ENEMY.SWARMER) n++;
    maxSwarm = Math.max(maxSwarm, n);
  };
  const k2 = runK(g2, 5, 60);
  assert.ok(k2 > 0 && maxSwarm > 0, 'enemies died and splitters split');
  assert.equal(k2, seen.length);
  assert.equal(new Set(seen).size, seen.length);
});

test('the pool holds at most DAGGER_CAP daggers; a full pool skips the launch and leaves every live dagger untouched', () => {
  const g = arenaGame();
  const d = g.wstate.daggers;
  assert.equal(d.on.length, DAGGER_CAP);
  g.player.stats.cooldownMult = 0.01; // level-5 interval 0.008 s < dt: a volley is due every update
  g.player.vx = 300;
  const px = g.player.x;
  const py = g.player.y;
  const volleys = DAGGER_CAP / 7;
  for (let v = 1; v <= volleys; v++) {
    runK(g, 5, 1);
    assert.equal(liveK(g), 7 * v); // each update launches a fresh volley of 7 into free slots
  }
  assert.equal(liveK(g), DAGGER_CAP);
  const a0 = angleK(g, 0);
  const left0 = d.left[0];
  runK(g, 5, 1); // the next volley finds no free slot
  assert.equal(liveK(g), DAGGER_CAP);
  assert.ok(Math.abs(d.x[0] - (px + volleys * STEP * Math.cos(a0))) < 1e-3); // slot 0 kept flying (one move per update after its launch), not relaunched
  assert.ok(Math.abs(d.y[0] - (py + volleys * STEP * Math.sin(a0))) < 1e-3);
  assert.ok(Math.abs(d.left[0] - (left0 - STEP)) < 1e-3);
  assert.equal(d.pierce[0], DAGGER_LEVELS[4].pierce);
  for (let t = 0; t < 60; t++) { runK(g, 5, 1); assert.ok(liveK(g) <= DAGGER_CAP); }
});

test('Daggers follow the level table: count, pierce, interval and range', () => {
  assert.deepEqual(DAGGER_LEVELS, [
    { count: 3, dmg: 18, pierce: 1, interval: 1.0, range: 320 },
    { count: 3, dmg: 24, pierce: 1, interval: 0.9, range: 340 },
    { count: 5, dmg: 26, pierce: 2, interval: 0.9, range: 360 },
    { count: 5, dmg: 34, pierce: 2, interval: 0.8, range: 380 },
    { count: 7, dmg: 38, pierce: 3, interval: 0.8, range: 400 },
  ]);
  for (let lv = 1; lv <= 5; lv++) {
    const L = DAGGER_LEVELS[lv - 1];
    const g = arenaGame();
    const d = g.wstate.daggers;
    g.player.vx = 300;
    runK(g, lv, 1);
    assert.equal(liveK(g), L.count, `level ${lv}`);
    for (let k = 0; k < L.count; k++) {
      assert.equal(d.pierce[k], L.pierce, `level ${lv}`);
      assert.equal(d.left[k], L.range, `level ${lv}`); // integer ranges are float32-exact
    }
    assert.equal(d.cd, L.interval, `level ${lv}`);
  }
});

test('stateHash changes with every dagger field, the volley timer and the active flag', () => {
  const g = arenaGame();
  settle(g);
  const empty = stateHash(g);
  g.player.vx = 300;
  updateDaggers(g, 1, 1 / 60);
  const d = g.wstate.daggers;
  const on = stateHash(g);
  assert.notEqual(on, empty);
  for (const f of ['x', 'y', 'dx', 'dy', 'left', 'pierce', 'lastHit', 'lastGen'] as const) {
    const v = d[f][0]; // restored exactly: a float32 +1 then -1 need not round-trip
    d[f][0] = v + 1;
    assert.notEqual(stateHash(g), on, f);
    d[f][0] = v;
  }
  assert.equal(stateHash(g), on);
  d.cd += 1;
  assert.notEqual(stateHash(g), on, 'cd');
  d.cd -= 1;
  d.on[0] = 0;
  assert.notEqual(stateHash(g), on, 'on');
  d.on[0] = 1;
  d.on[13] = 1; // a free slot still changes the hash when its flag does
  assert.notEqual(stateHash(g), on, 'on[13]');
});

test('Daggers is a levelled arena-only weapon offer that takes a slot, with the NEW and level-step tags', () => {
  const daggers = SKILLS.find((k) => k.id === 'daggers')!;
  assert.ok(daggers.arena);
  assert.ok(WEAPONS.some((w) => w.id === 'daggers'));
  const s = baseStats();
  assert.equal(daggers.tag!(s), 'NEW');
  applySkill(s, 'daggers');
  assert.equal(offerTag(s, 'daggers'), 'Lv 1 → 2');
  for (let n = 0; n < 4; n++) applySkill(s, 'daggers');
  assert.equal(s.weapons.daggers, 5);
  assert.equal(daggers.available!(s), false);
  const full = baseStats();
  full.weapons = { blade: 1, shockwave: 1, chain: 1, boomerang: 1 };
  assert.equal(Object.keys(full.weapons).length + 1, MAX_WEAPONS);
  assert.equal(daggers.available!(full), false);
  assert.ok(!SKILLS.filter((k) => !k.arena).some((k) => k.id === 'daggers')); // the Rooms pool is unchanged
});

test('a spent dagger overlapping two enemies on one move hits exactly one of them', () => {
  const g = arenaGame();
  g.player.vx = 300;
  const a = tough(g, at(g, 150, 0)); // spends the level-1 pierce on move 11
  const b = tough(g, at(g, 200, -8)); // b and c both first overlap the centre dagger on move 16 (x = 186.7)
  const c = tough(g, at(g, 200, 8));
  runK(g, 1, 30);
  assert.ok(lost(g, a) > 0);
  assert.equal([b, c].filter((e) => lost(g, e) > 0).length, 1, 'pierce 1 means two hits in all');
});

test('a dagger freed at range does not hit on its freeing move', () => {
  const g = arenaGame();
  g.player.vx = 300;
  const e = tough(g, at(g, 345, 0)); // move 27 (x = 315) is 30 px off; move 28 (x = 326.7, left < 0) would overlap
  runK(g, 1, 30);
  assert.equal(lost(g, e), 0);
});

test('a dagger that killed enemy j hits a new enemy recycled into slot j (lastGen is captured before the hit)', () => {
  const g = arenaGame();
  g.player.vx = 300;
  const j = at(g, 200, 0);
  g.world.hp[j] = 0.001;
  runK(g, 1, 17); // 16 moves: x = 186.7 kills j
  assert.equal(g.world.kind[j], KIND.NONE);
  assert.equal(g.wstate.daggers.on[1], 1);
  const j2 = tough(g, at(g, 200, 0)); // reuses slot j
  assert.equal(j2, j);
  runK(g, 1, 1); // move 17: x = 198.3 overlaps the new enemy
  assert.ok(lost(g, j2) > 0, 'the recycled slot is hit, not skipped');
  assert.equal(g.wstate.daggers.on[1], 0, 'its last pierce is spent');
});

test('the aim threshold uses the speed, not one axis: vy alone moves the fan, a slow diagonal counts as still', () => {
  const g = arenaGame();
  at(g, -100, 0);
  g.player.vy = 300;
  runK(g, 1, 1);
  assert.equal(liveK(g), 3);
  assert.ok(Math.abs(angleK(g, 1) - Math.PI / 2) < 1e-5);
  const g2 = arenaGame();
  at(g2, 120, -160);
  g2.player.vx = 14; g2.player.vy = 14; // speed 19.8 < DAGGER_MOVE_MIN, though |vx| + |vy| = 28 is above it
  runK(g2, 1, 1);
  assert.equal(liveK(g2), 3);
  assert.ok(Math.abs(angleK(g2, 1) - -Math.atan2(160, 120)) < 1e-5);
});

test('a still player with the nearest enemy beyond the level range holds fire and cd stays 0', () => {
  const g = arenaGame();
  at(g, 340, 0); // level-1 range 320
  runK(g, 1, 5);
  assert.equal(liveK(g), 0);
  assert.equal(g.wstate.daggers.cd, 0);
});

test('a relaunched slot forgets the previous dagger\'s last-hit enemy', () => {
  const g = arenaGame();
  g.player.vx = 300;
  const j = tough(g, at(g, 150, 0));
  runK(g, 1, 100); // volley 1 (updates 1-29) hits j once; volley 2 (from update 61 or 62) reuses slot 1 and must hit it again
  assert.ok(Math.abs(lost(g, j) - 2 * DAGGER_LEVELS[0].dmg) < 1e-3);
});
