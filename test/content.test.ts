import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';
import { ENEMY, ENEMY_TYPES, spawnEnemy } from '../src/game/enemies.ts';
import { createPlayer, fireVolley } from '../src/game/player.ts';
import { projectileSystem, HOMING_TURN } from '../src/core/systems.ts';
import { orbitSystem, bladePos, BLADE_DPS, BLADE_ORBIT, MAX_BLADES } from '../src/game/orbit.ts';
import { SKILLS, applySkill } from '../src/game/skills.ts';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS, pickMix, MIX } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import type { Game } from '../src/game/game.ts';

const BOUNDS = { w: 900, h: 600 };
const rig = () => ({ world: new World(200), grid: new Grid(900, 600, 64, 200), player: createPlayer(450, 300) });
const arena = () => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: () => 0.01, input: { x: 0, y: 0 } });
const count = (g: Game, type: number) => {
  let n = 0;
  for (let i = 0; i < g.world.high; i++) if (g.world.kind[i] === KIND.ENEMY && g.world.type[i] === type) n++;
  return n;
};

test('every ENEMY id indexes its own ENEMY_TYPES row', () => {
  for (const [name, id] of Object.entries(ENEMY)) assert.equal(ENEMY_TYPES[id].name, name.toLowerCase());
});

test('pickMix: nothing before the first unlock (and no rng call), then entries in order with cumulative shares', () => {
  let calls = 0;
  const never = () => (calls++, 0);
  assert.equal(pickMix(10, never), null);
  assert.equal(calls, 0);
  assert.equal(pickMix(40, () => 0)!.type, ENEMY.SWARMER); // shooters not unlocked yet
  assert.equal(pickMix(70, () => 0)!.type, ENEMY.SHOOTER);
  assert.equal(pickMix(70, () => 0.31)!.type, ENEMY.SWARMER); // 0.31 - 0.3 < 0.15
  assert.equal(pickMix(200, () => 0.3 + 0.15 + 0.01)!.type, ENEMY.BRUISER);
  assert.equal(pickMix(200, () => 0.3 + 0.15 + 0.08 + 0.01)!.type, ENEMY.SPLITTER);
  assert.equal(pickMix(200, () => 0.999), null); // chaser
  assert.ok(MIX.reduce((s, m) => s + m.share, 0) < 1);
});

test('a swarmer spawn is a pack and costs the director that many spawns of debt', () => {
  const g = arena();
  g.time = 40;
  g.mode.debt = 1;
  g.mode.update(g, 0);
  assert.equal(count(g, ENEMY.SWARMER), 4);
  assert.equal(g.mode.debt, -3);
});

test('a killed splitter leaves two swarmers and a gem', () => {
  const g = arena();
  const s = spawnEnemy(g.world, ENEMY.SPLITTER, 1500, 1000);
  g.mode.onKill(g, s);
  assert.equal(count(g, ENEMY.SWARMER), 2);
  assert.equal(g.world.kindCount[KIND.GEM], 1);
});

test('homing arrows turn toward an enemy at a capped rate and keep their speed', () => {
  const { world, grid } = rig();
  spawnEnemy(world, ENEMY.CHASER, 100, 200); // straight "down" from the arrow
  grid.rebuild(world, KIND.ENEMY);
  const p = world.spawn(KIND.PROJECTILE, 100, 100, 500, 0, 4, 0);
  world.life[p] = 5;
  world.type[p] = 1;
  const dt = 1 / 60;
  projectileSystem(world, dt, BOUNDS, grid);
  const turned = Math.atan2(world.vy[p], world.vx[p]);
  assert.ok(Math.abs(turned - HOMING_TURN * dt) < 1e-6, `turned ${turned}`); // +y is toward the enemy
  assert.ok(Math.abs(Math.hypot(world.vx[p], world.vy[p]) - 500) < 1e-3);
});

test('arrows without the homing flag fly straight, and a stale enemy slot in the grid is ignored', () => {
  const { world, grid } = rig();
  const e = spawnEnemy(world, ENEMY.CHASER, 100, 200);
  grid.rebuild(world, KIND.ENEMY);
  world.despawn(e); // grid still lists the slot
  const a = world.spawn(KIND.PROJECTILE, 100, 100, 500, 0, 4, 0);
  world.life[a] = 5;
  world.type[a] = 0;
  projectileSystem(world, 1 / 60, BOUNDS, grid);
  assert.equal(world.vy[a], 0);
  const b = world.spawn(KIND.PROJECTILE, 100, 100, 500, 0, 4, 0); // reuses a slot; homing but nothing live to chase
  world.life[b] = 5;
  world.type[b] = 1;
  projectileSystem(world, 1 / 60, BOUNDS, grid);
  assert.equal(world.vy[b], 0);
});

test('fireVolley flags every arrow from the homing stat, overwriting a stale slot type', () => {
  const { world, player } = rig();
  const i = world.spawn(KIND.ENEMY, 0, 0, 0, 0, 5, 5);
  world.type[i] = 5;
  world.despawn(i); // the next spawn reuses this slot
  fireVolley(world, player, 0);
  const j = world.high - 1;
  assert.equal(world.kind[j], KIND.PROJECTILE);
  assert.equal(world.type[j], 0);
  applySkill(player.stats, 'homing');
  fireVolley(world, player, 0);
  assert.equal(world.type[world.high - 1], 1);
});

test('orbit blades sit on the ring, spaced evenly, and damage overlapped enemies per second', () => {
  const { world, grid, player } = rig();
  player.stats.orbit = 2;
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  bladePos(player, 0, 0, a);
  bladePos(player, 0, 1, b);
  assert.ok(Math.abs(Math.hypot(a.x - player.x, a.y - player.y) - BLADE_ORBIT) < 1e-9);
  assert.ok(Math.abs(a.x + b.x - 2 * player.x) < 1e-9); // opposite sides
  const e = spawnEnemy(world, ENEMY.BRUISER, a.x, a.y);
  grid.rebuild(world, KIND.ENEMY);
  const kills: number[] = [];
  assert.equal(orbitSystem(world, grid, player, 0, 0.1, (j) => kills.push(j)), 0);
  assert.ok(Math.abs(world.hp[e] - (ENEMY_TYPES[ENEMY.BRUISER].hp - BLADE_DPS * 0.1)) < 1e-4);
  world.hp[e] = 1;
  assert.equal(orbitSystem(world, grid, player, 0, 0.1, (j) => kills.push(j)), 1);
  assert.deepEqual(kills, [e]);
  assert.equal(world.kind[e], KIND.NONE);
});

test('orbit blades do nothing at zero orbit, and the blade weapon caps at MAX_BLADES', () => {
  const { world, grid, player } = rig();
  spawnEnemy(world, ENEMY.CHASER, player.x + BLADE_ORBIT, player.y);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(orbitSystem(world, grid, player, 0, 1, null), 0);
  for (let k = 0; k < 8; k++) applySkill(player.stats, 'blade'); // five levels, then clamped
  assert.equal(player.stats.orbit, MAX_BLADES);
  assert.equal(player.stats.weapons.blade, 5);
});

test('a blade kill in a real tick counts as a kill and drops a gem', () => {
  const g = arena();
  g.player.stats.orbit = 1;
  const p = { x: 0, y: 0 };
  bladePos(g.player, g.time, 0, p);
  const e = spawnEnemy(g.world, ENEMY.SWARMER, p.x, p.y);
  g.world.hp[e] = 0.01;
  tick(g, 1 / 60);
  assert.equal(g.kills, 1);
  assert.equal(g.world.kindCount[KIND.GEM], 1);
});

test('regeneration heals up to max HP and no further', () => {
  const g = arena();
  g.player.stats.regen = 2;
  g.player.hp = 50;
  tick(g, 1);
  assert.ok(g.player.hp > 51.9 && g.player.hp <= 52.1, `hp ${g.player.hp}`);
  g.player.hp = g.player.maxHp - 0.1;
  tick(g, 1);
  assert.equal(g.player.hp, g.player.maxHp);
});

test('new skills are registered with unique ids', () => {
  const ids = SKILLS.map((s) => s.id);
  for (const id of ['regen', 'magnet', 'homing', 'blade']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a homing arrow does not turn back toward the enemy it just pierced', () => {
  const { world, grid } = rig();
  const a = spawnEnemy(world, ENEMY.CHASER, 100, 130);
  grid.rebuild(world, KIND.ENEMY);
  const p = world.spawn(KIND.PROJECTILE, 100, 100, 0, 500, 4, 0); // heading at the enemy
  world.life[p] = 5;
  world.type[p] = 1;
  world.lastHit[p] = a;
  world.lastHitGen[p] = world.gen[a];
  world.y[p] = 160; // already past it, enemy now behind
  projectileSystem(world, 1 / 60, BOUNDS, grid);
  assert.equal(world.vx[p], 0);
});

test('packs and splits respect ENEMY_CAP and stay inside the world', () => {
  const g = arena();
  g.time = 40;
  g.mode.debt = 1;
  for (let k = 0; k < 799; k++) spawnEnemy(g.world, ENEMY.CHASER, 1500, 1000);
  g.mode.update(g, 0);
  assert.equal(g.world.kindCount[KIND.ENEMY], 800); // pack trimmed to the one free slot
  const s = spawnEnemy(g.world, ENEMY.SPLITTER, 5, 5); // corner: split offsets would leave the world
  g.mode.onKill(g, s);
  for (let i = 0; i < g.world.high; i++) {
    if (g.world.kind[i] !== KIND.ENEMY) continue;
    assert.ok(g.world.x[i] >= 20 && g.world.y[i] >= 20 || g.world.x[i] === 5);
  }
  assert.equal(count(g, ENEMY.SWARMER), 1); // at the cap before the split: none added beyond the pack's one
});
