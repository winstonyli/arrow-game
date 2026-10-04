import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';

function setup() {
  return { world: new World(100), grid: new Grid(640, 640, 64, 100) };
}
const enemy = (w: World, x: number, y: number) => w.spawn(KIND.ENEMY, x, y, 0, 0, 10, 10);
const sorted = (grid: Grid, n: number) => Array.from(grid.out.subarray(0, n)).sort((p, q) => p - q);

test('nearest returns the closest enemy within range', () => {
  const { world, grid } = setup();
  enemy(world, 300, 300);
  const near = enemy(world, 120, 100);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(grid.nearest(world, 100, 100, 500), near);
});

test('nearest returns -1 when nothing is within maxR', () => {
  const { world, grid } = setup();
  enemy(world, 300, 300);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(grid.nearest(world, 100, 100, 50), -1);
});

test('rebuild only indexes the requested kind', () => {
  const { world, grid } = setup();
  world.spawn(KIND.PROJECTILE, 100, 100, 0, 0, 4, 0);
  enemy(world, 500, 500);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(grid.gather(100, 100, 20), 0);
});

test('gather returns candidates from overlapping cells only', () => {
  const { world, grid } = setup();
  const a = enemy(world, 40, 40);
  const b = enemy(world, 70, 40);
  enemy(world, 500, 500);
  grid.rebuild(world, KIND.ENEMY);
  const n = grid.gather(60, 40, 10);
  assert.deepEqual(sorted(grid, n), [a, b]);
});

test('entities outside the bounds clamp into edge cells', () => {
  const { world, grid } = setup();
  const e = enemy(world, -50, 100);
  grid.rebuild(world, KIND.ENEMY);
  const n = grid.gather(5, 100, 10);
  assert.deepEqual(sorted(grid, n), [e]);
});

test('rebuild drops despawned entities', () => {
  const { world, grid } = setup();
  const e = enemy(world, 100, 100);
  grid.rebuild(world, KIND.ENEMY);
  world.despawn(e);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(grid.gather(100, 100, 20), 0);
});

test('maxRadius is the largest radius of the wanted kind at the last rebuild', () => {
  const { world, grid } = setup();
  enemy(world, 100, 100);
  world.spawn(KIND.ENEMY, 200, 200, 0, 0, 36, 10);
  world.spawn(KIND.PROJECTILE, 300, 300, 0, 0, 50, 0);
  grid.rebuild(world, KIND.ENEMY);
  assert.equal(grid.maxRadius, 36);
  grid.rebuild(world, KIND.PROJECTILE);
  assert.equal(grid.maxRadius, 50);
  world.clearKind(KIND.PROJECTILE);
  grid.rebuild(world, KIND.PROJECTILE);
  assert.equal(grid.maxRadius, 0);
});
