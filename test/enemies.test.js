import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { ENEMY, spawnEnemy, enemyAISystem } from '../src/game/enemies.js';

test('spawnEnemy fills type, hp and contact damage', () => {
  const w = new World(10);
  const i = spawnEnemy(w, ENEMY.CHASER, 10, 20);
  assert.equal(w.kind[i], KIND.ENEMY);
  assert.equal(w.type[i], ENEMY.CHASER);
  assert.equal(w.hp[i], 20);
  assert.equal(w.damage[i], 10);
});

test('chaser steers toward the player at its speed', () => {
  const w = new World(10);
  const i = spawnEnemy(w, ENEMY.CHASER, 100, 100);
  enemyAISystem(w, { x: 300, y: 100 }, 0.016);
  assert.ok(Math.abs(w.vx[i] - 90) < 1e-3);
  assert.ok(Math.abs(w.vy[i]) < 1e-3);
});

test('shooter holds position inside keepDist', () => {
  const w = new World(10);
  const i = spawnEnemy(w, ENEMY.SHOOTER, 100, 100);
  enemyAISystem(w, { x: 200, y: 100 }, 0.016);
  assert.equal(w.vx[i], 0);
});

test('shooter fires one aimed projectile after its interval', () => {
  const w = new World(10);
  spawnEnemy(w, ENEMY.SHOOTER, 100, 100);
  const player = { x: 300, y: 100 };
  enemyAISystem(w, player, 1);
  assert.equal(w.kindCount[KIND.ENEMY_PROJECTILE], 0);
  enemyAISystem(w, player, 1.01);
  assert.equal(w.kindCount[KIND.ENEMY_PROJECTILE], 1);
  let p = -1;
  for (let i = 0; i < w.high; i++) if (w.kind[i] === KIND.ENEMY_PROJECTILE) p = i;
  assert.ok(Math.abs(w.vx[p] - 220) < 1e-3);
  assert.equal(w.damage[p], 8);
});

test('boss fires a ring of 12', () => {
  const w = new World(50);
  spawnEnemy(w, ENEMY.BOSS, 100, 100);
  enemyAISystem(w, { x: 400, y: 100 }, 2);
  assert.equal(w.kindCount[KIND.ENEMY_PROJECTILE], 12);
});

test('with a camera, a shooter outside the view holds fire and inside it fires', () => {
  const view = { w: 900, h: 600 };
  const player = { x: 300, y: 100 };
  const off = new World(10);
  spawnEnemy(off, ENEMY.SHOOTER, 100, 100);
  enemyAISystem(off, player, 2.1, { x: 500, y: 0 }, view); // shooter at x=100 is left of the view
  assert.equal(off.kindCount[KIND.ENEMY_PROJECTILE], 0);
  const on = new World(10);
  spawnEnemy(on, ENEMY.SHOOTER, 100, 100);
  enemyAISystem(on, player, 2.1, { x: 0, y: 0 }, view);
  assert.equal(on.kindCount[KIND.ENEMY_PROJECTILE], 1);
});
