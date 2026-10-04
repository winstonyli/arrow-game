import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { Grid } from '../src/core/grid.ts';
import { createPlayer } from '../src/game/player.ts';
import { ENEMY, spawnEnemy } from '../src/game/enemies.ts';
import { moveSystem, projectileSystem, collisionSystem } from '../src/core/systems.ts';

const bounds = { w: 900, h: 600 };

function scene() {
  return { world: new World(200), grid: new Grid(900, 600, 64, 200), player: createPlayer(450, 500) };
}
function shot(world, x, y, { damage = 10, pierce = 0, bounce = 0, vx = 0, vy = 0, life = 5 } = {}) {
  const i = world.spawn(KIND.PROJECTILE, x, y, vx, vy, 4, 0);
  world.damage[i] = damage;
  world.life[i] = life;
  world.pierce[i] = pierce;
  world.bounce[i] = bounce;
  return i;
}
function collide({ world, grid, player }) {
  grid.rebuild(world, KIND.ENEMY);
  return collisionSystem(world, grid, player);
}

test('a projectile damages an enemy and despawns', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  const s = shot(sc.world, 105, 100, { damage: 10 });
  assert.equal(collide(sc), 0);
  assert.equal(sc.world.hp[e], 10);
  assert.equal(sc.world.kind[s], KIND.NONE);
});

test('a lethal hit despawns the enemy and counts a kill', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  shot(sc.world, 105, 100, { damage: 25 });
  assert.equal(collide(sc), 1);
  assert.equal(sc.world.kind[e], KIND.NONE);
});

test('a miss changes nothing', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  const s = shot(sc.world, 300, 300);
  collide(sc);
  assert.equal(sc.world.hp[e], 20);
  assert.equal(sc.world.kind[s], KIND.PROJECTILE);
});

test('pierce 1 hits two overlapping enemies then despawns', () => {
  const sc = scene();
  const a = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  const b = spawnEnemy(sc.world, ENEMY.CHASER, 115, 100);
  const s = shot(sc.world, 107, 100, { damage: 5, pierce: 1 });
  collide(sc);
  assert.equal(sc.world.hp[a], 15);
  assert.equal(sc.world.hp[b], 15);
  assert.equal(sc.world.kind[s], KIND.NONE);
});

test('a piercing projectile does not re-hit the same enemy next tick', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  const s = shot(sc.world, 105, 100, { damage: 5, pierce: 1 });
  collide(sc);
  collide(sc);
  assert.equal(sc.world.hp[e], 15);
  assert.equal(sc.world.kind[s], KIND.PROJECTILE);
});

test('enemy contact hurts the player once per invulnerability window', () => {
  const sc = scene();
  spawnEnemy(sc.world, ENEMY.CHASER, 450, 500);
  collide(sc);
  assert.equal(sc.player.hp, 90);
  collide(sc);
  assert.equal(sc.player.hp, 90);
});

test('an enemy projectile hurts the player and despawns', () => {
  const sc = scene();
  const p = sc.world.spawn(KIND.ENEMY_PROJECTILE, 450, 500, 0, 0, 5, 0);
  sc.world.damage[p] = 8;
  collide(sc);
  assert.equal(sc.player.hp, 92);
  assert.equal(sc.world.kind[p], KIND.NONE);
});

test('moveSystem integrates velocity', () => {
  const w = new World(4);
  const i = w.spawn(KIND.ENEMY, 10, 10, 10, -20, 5, 1);
  moveSystem(w, 0.5);
  assert.equal(w.x[i], 15);
  assert.equal(w.y[i], 0);
});

test('projectiles expire when their life runs out', () => {
  const { world } = scene();
  const s = shot(world, 300, 300, { life: 0.05 });
  projectileSystem(world, 0.1, bounds);
  assert.equal(world.kind[s], KIND.NONE);
});

test('projectiles bounce off walls while bounces remain, else despawn', () => {
  const { world } = scene();
  const b = shot(world, 3, 300, { vx: -100, bounce: 1 });
  const d = shot(world, 3, 300, { vx: -100, bounce: 0 });
  projectileSystem(world, 0.016, bounds);
  assert.equal(world.kind[b], KIND.PROJECTILE);
  assert.equal(world.vx[b], 100);
  assert.equal(world.bounce[b], 0);
  assert.equal(world.kind[d], KIND.NONE);
});

test('a projectile reaches a boss across a cell boundary (search radius follows the largest enemy)', () => {
  const sc = scene();
  const boss = spawnEnemy(sc.world, ENEMY.BOSS, 100, 100); // radius 36, cell 64: projectile sits one cell over
  shot(sc.world, 138, 100, { damage: 10 });
  collide(sc);
  assert.equal(sc.world.hp[boss], 590);
});

test('a piercing projectile hits a new enemy that reuses the slot of the one it last hit', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  shot(sc.world, 105, 100, { damage: 25, pierce: 2 });
  assert.equal(collide(sc), 1); // kills e; the projectile pierces on
  const n = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  assert.equal(n, e); // LIFO free list reuses the slot
  assert.equal(collide(sc), 1); // the new enemy is a different occupant, so it is hit
});

test('onKill is called once, before the enemy is despawned, only for lethal hits', () => {
  const sc = scene();
  const e = spawnEnemy(sc.world, ENEMY.CHASER, 100, 100);
  const seen = [];
  const run = () => {
    sc.grid.rebuild(sc.world, KIND.ENEMY);
    return collisionSystem(sc.world, sc.grid, sc.player, (j) => seen.push([j, sc.world.kind[j]]));
  };
  shot(sc.world, 105, 100, { damage: 10 }); // hp 20 -> 10: not lethal
  run();
  assert.deepEqual(seen, []);
  shot(sc.world, 105, 100, { damage: 10 }); // lethal
  assert.equal(run(), 1);
  assert.deepEqual(seen, [[e, KIND.ENEMY]]);
});
