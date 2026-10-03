import test from 'node:test';
import assert from 'node:assert/strict';
import { packInstances, STRIDE } from '../src/render/webgl.js';
import { World, KIND } from '../src/core/world.js';
import { spawnEnemy, ENEMY, ENEMY_TYPES } from '../src/game/enemies.js';

const player = (over = {}) => ({ x: 5, y: 6, radius: 12, invuln: 0, ...over });
const G = (o = {}) => ({ time: 0, camera: { x: 0, y: 0 }, view: { w: 900, h: 600 }, ...o });

test('packInstances writes live entities in slot order, player last, skipping free slots', () => {
  const w = new World(10);
  const a = spawnEnemy(w, ENEMY.SHOOTER, 1, 2);
  const b = spawnEnemy(w, ENEMY.CHASER, 3, 4);
  w.spawn(KIND.PROJECTILE, 7, 8, 0, 0, 4, 0);
  w.spawn(KIND.ENEMY_PROJECTILE, 9, 10, 0, 0, 5, 0);
  w.despawn(b);
  const out = new Float32Array(11 * STRIDE);
  const n = packInstances(w, player(), G(), out);
  assert.equal(n, 4); // shooter, projectile, enemy projectile, player
  const row = (k) => Array.from(out.subarray(k * STRIDE, (k + 1) * STRIDE));
  const T = ENEMY_TYPES.length;
  assert.deepEqual(row(0), [1, 2, ENEMY_TYPES[ENEMY.SHOOTER].radius, ENEMY.SHOOTER]);
  assert.deepEqual(row(1), [7, 8, 4, T + 1]);
  assert.deepEqual(row(2), [9, 10, 5, T]);
  assert.deepEqual(row(3), [5, 6, 12, T + 2]);
  assert.ok(a >= 0);
});

test('player blinks only while invulnerable', () => {
  const w = new World(2);
  const out = new Float32Array(3 * STRIDE);
  const T = ENEMY_TYPES.length;
  packInstances(w, player({ invuln: 0.3 }), G({ time: 0.05 }), out); // floor(0.05*20)=1 -> odd -> blink
  assert.equal(out[3], T + 3);
  packInstances(w, player({ invuln: 0.3 }), G(), out);
  assert.equal(out[3], T + 2);
  packInstances(w, player({ invuln: 0 }), G({ time: 0.05 }), out);
  assert.equal(out[3], T + 2);
});

test('packInstances culls entities fully outside the view but keeps the player', () => {
  const w = new World(10);
  w.spawn(KIND.ENEMY, 2000, 100, 0, 0, 10, 10); // far right: culled
  w.spawn(KIND.ENEMY, 895, 100, 0, 0, 10, 10); // inside
  w.spawn(KIND.ENEMY, -8, 100, 0, 0, 10, 10); // circle reaches x = 2: kept
  w.spawn(KIND.ENEMY, -11, 100, 0, 0, 10, 10); // circle ends at x = -1: culled
  const out = new Float32Array(11 * STRIDE);
  const n = packInstances(w, player({ x: 5000, y: 5000 }), G(), out);
  assert.equal(n, 3); // two enemies + the player
  assert.equal(out[0], 895);
  assert.equal(out[STRIDE], -8);
});

test('packInstances follows the camera', () => {
  const w = new World(4);
  w.spawn(KIND.ENEMY, 2000, 100, 0, 0, 10, 10);
  const out = new Float32Array(5 * STRIDE);
  assert.equal(packInstances(w, player(), G(), out), 1); // player only
  assert.equal(packInstances(w, player(), G({ camera: { x: 1500, y: 0 } }), out), 2);
});
