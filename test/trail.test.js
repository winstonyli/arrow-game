import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.js';
import { spawnEnemy, ENEMY, ENEMY_TYPES } from '../src/game/enemies.js';
import { spawnGem } from '../src/game/gems.js';
import { createFx } from '../src/render/fx.js';
import { bentTail, TRAIL_MAX, TRAIL_N, TRAIL_DT, TRAIL_MID, TRAIL_END } from '../src/render/trail.js';
import { packInstances, STRIDE } from '../src/render/webgl.js';

const out = { mx: 0, my: 0, ex: 0, ey: 0 };
const len = (x, y) => Math.hypot(x, y);
// Moves the mover by (dx, dy) per sample for `n` samples (each: move, observe, advance the clock one sample).
const run = (game, i, n, dx, dy) => {
  for (let k = 0; k < n; k++) {
    game.world.x[i] += dx;
    game.world.y[i] += dy;
    game.fx.observe(game);
    game.fx.update(TRAIL_DT);
  }
};
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

test('bentTail keeps the shape, caps the tip at TRAIL_MAX, and is zero for a mover that has not moved', () => {
  bentTail(-10, 0, -30, 20, out);
  assert.deepEqual([out.mx, out.my, out.ex, out.ey], [-10, 0, -30, 20]);
  bentTail(-1000, 0, -5000, 5000, out);
  assert.ok(Math.abs(len(out.ex, out.ey) - TRAIL_MAX) < 1e-9 && Math.abs(out.ex + out.ey * 1) < 1e-9);
  assert.ok(Math.abs(out.my) < 1e-9 && out.mx < 0 && len(out.mx, out.my) <= TRAIL_MAX);
  bentTail(0, 0, 0, 0, out, 10);
  assert.deepEqual([out.mx, out.my, out.ex, out.ey], [0, 0, 0, 0]);
});

test('the tail starts at the rim: radius is added, ramping in over the first 10 px, and still capped', () => {
  bentTail(-20, 0, -40, 0, out, 10);
  assert.ok(Math.abs(out.ex + 50) < 1e-6 && Math.abs(out.mx + 25) < 1e-6); // both points scale by (40 + 10) / 40
  bentTail(-2, 0, -4.5, 0, out, 10); // 4.5 px of motion: only part of the radius is added
  assert.ok(Math.abs(out.ex + (4.5 + 10 * 0.45)) < 1e-9);
  bentTail(-100, 0, -5000, 0, out, 36);
  assert.ok(Math.abs(out.ex + TRAIL_MAX) < 1e-9);
});

test('a mover on a straight path packs a straight tail along its real displacement', () => {
  const { world, game } = rig();
  const e = spawnEnemy(world, ENEMY.CHASER, 300, 300);
  run(game, e, TRAIL_N + 2, 2, 0);
  const r = pack(game).row(0);
  const rad = ENEMY_TYPES[ENEMY.CHASER].radius;
  const want = TRAIL_END * 2 + rad; // 18 px of path from the newest sample
  assert.ok(Math.abs(r[7] + want) < 0.5 && Math.abs(r[8]) < 1e-6, `tip ${r[7]},${r[8]}`);
  assert.ok(Math.abs(r[6]) < 1e-6 && r[5] < 0 && r[5] > r[7]); // the bend lies between the centre and the tip
  const noFx = pack({ ...game, fx: undefined }).row(0);
  assert.deepEqual(noFx.slice(5), [0, 0, 0, 0]);
});

test('a turning mover packs a bent tail through where it was, not along its velocity', () => {
  const { world, game } = rig();
  const e = spawnEnemy(world, ENEMY.CHASER, 300, 300);
  run(game, e, TRAIL_N, 3, 0); // east, then
  run(game, e, TRAIL_MID, 0, 3); // south for the last TRAIL_MID samples
  world.vx[e] = 0;
  world.vy[e] = 180; // velocity alone would say "straight up the tail"
  const r = pack(game).row(0);
  assert.ok(Math.abs(r[5]) < 1e-6 && r[6] < 0, `bend ${r[5]},${r[6]}`); // the bend is straight back along y
  assert.ok(r[7] < -1 && r[8] < 0, `tip ${r[7]},${r[8]}`); // the tip swings back toward the earlier eastward run
});

test('a young mover has a straight tail from its first samples; a stationary one has none', () => {
  const { world, game } = rig();
  const e = spawnEnemy(world, ENEMY.CHASER, 300, 300);
  const s = spawnEnemy(world, ENEMY.CHASER, 500, 500);
  game.fx.observe(game); // first sample: nothing to trail from
  assert.deepEqual(pack(game).row(0).slice(5), [0, 0, 0, 0]);
  run(game, e, 2, 4, 0);
  const r = pack(game).row(0);
  assert.ok(r[7] < -8 && Math.abs(r[5] - r[7] / 2) < 1e-6); // bend halfway to the tip
  assert.deepEqual(pack(game).row(1).slice(5), [0, 0, 0, 0]); // s never moved
});

test('a recycled slot packs no tail from the previous occupant', () => {
  const { world, game } = rig();
  const a = world.spawn(KIND.PROJECTILE, 300, 300, 500, 0, 4, 0);
  run(game, a, TRAIL_N + 2, 8, 0);
  world.despawn(a);
  const b = spawnEnemy(world, ENEMY.CHASER, 300, 300); // reuses the slot
  assert.equal(b, a);
  assert.deepEqual(pack(game).row(0).slice(5), [0, 0, 0, 0]); // not sampled yet
  run(game, b, 1, 0, 0);
  assert.deepEqual(pack(game).row(0).slice(5), [0, 0, 0, 0]); // sampled once, still: no history of its own
});

test('a gem is trailed through its real path, and holds the tail across frames with no new sample', () => {
  const { world, game } = rig();
  const g = spawnGem(world, 500, 500, 1);
  run(game, g, TRAIL_N + 2, 0, 1.5);
  game.fx.observe(game); // takes the pending sample
  const before = pack(game).row(0);
  assert.ok(before[8] < 0 && Math.abs(before[7]) < 1e-6);
  game.fx.observe(game); // a frame with no time passing: unchanged
  assert.deepEqual(pack(game).row(0), before);
});

test('the player trails through its real path, and a blade through its orbit', () => {
  const { fx, player, game } = rig();
  player.stats.orbit = 1;
  const t = { mx: 0, my: 0, ex: 0, ey: 0 };
  fx.trackTail(0, player.x, player.y, 12, t);
  assert.deepEqual([t.mx, t.my, t.ex, t.ey], [0, 0, 0, 0]); // no history yet
  for (let k = 0; k < TRAIL_N + 3; k++) {
    player.x += 3;
    game.time = k * TRAIL_DT;
    fx.observe(game);
    fx.update(TRAIL_DT);
  }
  fx.trackTail(0, player.x, player.y, 12, t);
  assert.ok(t.ex < -(TRAIL_END * 3) && Math.abs(t.ey) < 1e-9 && t.mx < 0 && t.mx > t.ex, `${t.mx},${t.ex}`);
  fx.observe(game); // takes the pending sample
  fx.trackTail(0, player.x, player.y, 12, t);
  const r = pack(game);
  const row = r.row(r.n - 1); // the player packs last, with its tail
  assert.ok(Math.abs(row[7] - t.ex) < 1e-4 && row[7] < 0);
  fx.observe(game); // no clock advance (paused): no new sample
  assert.deepEqual(pack(game).row(r.n - 1), row);
  fx.trackTail(1, 0, 0, 8, t); // blade 0 has its own track
  assert.ok(t.ex !== 0 || t.ey !== 0);
});

test('blade tracks follow the orbit count and are cleared when a blade is gone; blades and player pack with no dots', () => {
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
  assert.equal(pack(game).n, 2 + 1); // 2 blades, 1 player
  player.stats.orbit = 1;
  game.time += TRAIL_DT;
  fx.observe(game);
  fx.update(TRAIL_DT);
  assert.equal(fx.trail.count[2], 0);
});
