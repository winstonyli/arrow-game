import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';
import { createPlayer, movePlayer, autoFire } from '../src/game/player.js';

const bounds = { w: 900, h: 600 };

function scene() {
  return { world: new World(200), grid: new Grid(900, 600, 64, 200), player: createPlayer(450, 300) };
}
function addEnemy(world, grid, x, y) {
  const i = world.spawn(KIND.ENEMY, x, y, 0, 0, 10, 10);
  grid.rebuild(world, KIND.ENEMY);
  return i;
}
function projectiles(world) {
  const out = [];
  for (let i = 0; i < world.high; i++) if (world.kind[i] === KIND.PROJECTILE) out.push(i);
  return out;
}

test('movePlayer moves at moveSpeed', () => {
  const p = createPlayer(450, 300);
  movePlayer(p, { x: 1, y: 0 }, 1, bounds);
  assert.equal(p.x, 450 + 220);
  assert.equal(p.moving, true);
});

test('movePlayer normalises diagonals and scales analog input', () => {
  const p = createPlayer(450, 300);
  movePlayer(p, { x: 1, y: 1 }, 1, bounds);
  assert.ok(Math.abs(Math.hypot(p.x - 450, p.y - 300) - 220) < 1e-6);
  const q = createPlayer(450, 300);
  movePlayer(q, { x: 0.5, y: 0 }, 1, bounds);
  assert.ok(Math.abs(q.x - (450 + 110)) < 1e-6);
});

test('movePlayer clamps to bounds and reports not moving on zero input', () => {
  const p = createPlayer(20, 300);
  movePlayer(p, { x: -1, y: 0 }, 1, bounds);
  assert.equal(p.x, p.radius);
  movePlayer(p, { x: 0, y: 0 }, 0.016, bounds);
  assert.equal(p.moving, false);
});

test('autoFire shoots the nearest enemy only while standing still', () => {
  const { world, grid, player } = scene();
  addEnemy(world, grid, 650, 300);
  player.moving = true;
  assert.equal(autoFire(player, world, grid, 0.016), 0);
  player.moving = false;
  assert.equal(autoFire(player, world, grid, 0.016), 1);
  const [s] = projectiles(world);
  assert.ok(Math.abs(world.vx[s] - 500) < 1e-3);
  assert.ok(Math.abs(world.vy[s]) < 1e-3);
  assert.equal(world.damage[s], 10);
});

test('autoFire respects attackInterval', () => {
  const { world, grid, player } = scene();
  addEnemy(world, grid, 650, 300);
  assert.equal(autoFire(player, world, grid, 0.016), 1);
  assert.equal(autoFire(player, world, grid, 0.1), 0);
  assert.equal(autoFire(player, world, grid, 0.5), 1);
});

test('autoFire ignores enemies beyond range', () => {
  const { world, grid, player } = scene();
  player.stats.range = 100;
  addEnemy(world, grid, 650, 300);
  assert.equal(autoFire(player, world, grid, 0.016), 0);
});

test('multishot fans out symmetrically', () => {
  const { world, grid, player } = scene();
  player.stats.projectileCount = 3;
  addEnemy(world, grid, 650, 300);
  assert.equal(autoFire(player, world, grid, 0.016), 3);
  const vys = projectiles(world).map((i) => world.vy[i]);
  assert.equal(vys.length, 3);
  assert.ok(Math.abs(vys.reduce((a, b) => a + b, 0)) < 1e-3);
  assert.ok(vys.some((v) => Math.abs(v) < 1e-3));
});

test('moveFireRate lets the player shoot on the move at a slower cadence', () => {
  const { world, grid, player } = scene();
  addEnemy(world, grid, 650, 300);
  player.stats.moveFireRate = 0.5;
  player.moving = true;
  assert.equal(autoFire(player, world, grid, 0.016), 1);
  assert.equal(autoFire(player, world, grid, 0.6), 0); // attackInterval 0.5 doubles to 1.0 while moving
  assert.equal(autoFire(player, world, grid, 0.45), 1);
  player.moving = false;
  assert.equal(autoFire(player, world, grid, 0.016), 0); // still on the slow cooldown from the last shot
  assert.equal(autoFire(player, world, grid, 1), 1);
  assert.equal(autoFire(player, world, grid, 0.55), 1); // standing still: back to 0.5 s
});
