import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.js';
import { spawnEnemy, ENEMY } from '../src/game/enemies.js';
import { spawnGem } from '../src/game/gems.js';
import { createFx } from '../src/render/fx.js';
import { tailVec, TRAIL_TIME, TRAIL_MAX, TRAIL_N, TRAIL_DT } from '../src/render/trail.js';
import { packInstances, STRIDE } from '../src/render/webgl.js';

const out = { x: 0, y: 0 };
const rig = () => {
  const world = new World(50);
  const fx = createFx(50, () => 0.5);
  const player = { x: 100, y: 100, radius: 12, invuln: 0, hp: 100, maxHp: 100, stats: { orbit: 0 } };
  const game = { world, player, fx, time: 0, camera: { x: 0, y: 0 }, view: { w: 900, h: 600 } };
  return { world, fx, player, game };
};
const pack = (game) => {
  const buf = new Float32Array(200 * STRIDE);
  const n = packInstances(game.world, game.player, game, buf);
  return { buf, n, row: (k) => Array.from(buf.subarray(k * STRIDE, (k + 1) * STRIDE)) };
};

test('tailVec points back along the velocity, scaled by TRAIL_TIME and capped at TRAIL_MAX', () => {
  tailVec(100, -40, out);
  assert.ok(Math.abs(out.x + 100 * TRAIL_TIME) < 1e-9 && Math.abs(out.y - 40 * TRAIL_TIME) < 1e-9);
  tailVec(5000, 0, out);
  assert.ok(Math.abs(Math.hypot(out.x, out.y) - TRAIL_MAX) < 1e-9 && out.x < 0);
  tailVec(0, 0, out);
  assert.ok(out.x === 0 && out.y === 0); // -0 counts
});

test('a moving enemy packs its tail; with no fx (stress) every tail is zero', () => {
  const { world, game } = rig();
  const e = spawnEnemy(world, ENEMY.CHASER, 300, 300);
  world.vx[e] = 90;
  world.vy[e] = 0;
  const r = pack(game).row(0);
  assert.ok(Math.abs(r[5] + 90 * TRAIL_TIME) < 1e-4 && r[6] === 0, `tail ${r[5]},${r[6]}`);
  const noFx = pack({ ...game, fx: undefined }).row(0);
  assert.ok(noFx[5] === 0 && noFx[6] === 0);
});

test('a recycled slot packs no tail from the previous occupant', () => {
  const { world, game } = rig();
  const a = world.spawn(KIND.PROJECTILE, 300, 300, 500, 0, 4, 0);
  world.despawn(a);
  const b = spawnEnemy(world, ENEMY.CHASER, 300, 300); // reuses the slot; spawn zeroes velocity
  assert.equal(b, a);
  const r = pack(game).row(0);
  assert.ok(r[5] === 0 && r[6] === 0);
});

test('gem velocity is derived per sim tick, holds across frames with no tick, and resets on a recycled slot', () => {
  const { world, fx, game } = rig();
  const g = spawnGem(world, 500, 500, 1);
  game.time = 0.1;
  fx.observe(game); // first sight: no velocity
  assert.equal(fx.gvx[g], 0);
  world.x[g] += 6; // moved 6 px over the next 0.1 s of sim time
  game.time = 0.2;
  fx.observe(game);
  assert.ok(Math.abs(fx.gvx[g] - 60) < 1e-3, `gvx ${fx.gvx[g]}`);
  fx.observe(game); // a frame with no sim tick: unchanged, not zero
  assert.ok(Math.abs(fx.gvx[g] - 60) < 1e-3);
  assert.ok(pack(game).row(0)[5] < 0);
  world.despawn(g);
  const h = spawnGem(world, 700, 700, 1);
  assert.equal(h, g);
  game.time = 0.3;
  fx.observe(game);
  assert.equal(fx.gvx[h], 0);
});

test('player history samples at TRAIL_DT, newest first, capped at TRAIL_N', () => {
  const { fx, player, game } = rig();
  const p = { x: 0, y: 0 };
  assert.equal(fx.sample(0, 0, p), false);
  for (let k = 0; k < TRAIL_N + 5; k++) {
    player.x = k;
    fx.observe(game);
    fx.update(TRAIL_DT);
  }
  assert.equal(fx.sample(0, 0, p), true);
  assert.equal(p.x, TRAIL_N + 4);
  assert.equal(fx.sample(0, 1, p), true);
  assert.equal(p.x, TRAIL_N + 3);
  assert.equal(fx.sample(0, TRAIL_N, p), false); // older than the ring
  fx.observe(game); // no clock advance (paused): no new sample
  fx.sample(0, 0, p);
  assert.equal(p.x, TRAIL_N + 4);
});

test('blade tracks follow the orbit count and are cleared when a blade is gone; dots pack under the blades and player', () => {
  const { fx, player, game } = rig();
  player.stats.orbit = 2;
  for (let k = 0; k < 4; k++) {
    game.time = k * TRAIL_DT;
    fx.observe(game);
    fx.update(TRAIL_DT);
  }
  assert.equal(fx.trail.count[1], 4);
  assert.equal(fx.trail.count[2], 4);
  assert.equal(fx.trail.count[3], 0);
  const { n } = pack(game);
  // 3 tracks x 3 dots (ages 1..3), 2 blades, 1 player
  assert.equal(n, 9 + 2 + 1);
  player.stats.orbit = 1;
  game.time += TRAIL_DT;
  fx.observe(game);
  fx.update(TRAIL_DT);
  assert.equal(fx.trail.count[2], 0);
});
