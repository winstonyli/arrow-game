import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.js';
import { createPlayer } from '../src/game/player.js';
import { spawnGem, gemSystem, GEM_LIFE } from '../src/game/gems.js';

const setup = () => ({ world: new World(20), player: createPlayer(450, 500) });
const dt = 1 / 60;

test('spawnGem stores the value in damage and a life timer', () => {
  const { world } = setup();
  const g = spawnGem(world, 10, 20, 3);
  assert.equal(world.kind[g], KIND.GEM);
  assert.equal(world.damage[g], 3);
  assert.equal(world.life[g], GEM_LIFE);
});

test('a gem outside the pickup radius stays put', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 400, 1); // 100 away, reach is 80
  assert.equal(gemSystem(world, player, dt), 0);
  assert.equal(world.y[g], 400);
});

test('a gem inside the pickup radius is captured and moves closer without being collected', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 450, 1); // 50 away, straight above
  assert.equal(gemSystem(world, player, dt), 0);
  assert.ok(world.cd[g] > 0);
  assert.ok(Math.hypot(world.x[g] - 450, world.y[g] - 500) < 50);
  assert.equal(world.kind[g], KIND.GEM);
  assert.equal(world.vx[g], 0); // gems keep zero velocity: gemSystem moves them directly
});

test('a touching gem is collected, summed and despawned', () => {
  const { world, player } = setup();
  const a = spawnGem(world, 450, 490, 3); // 10 away, touch distance is 12 + 5
  spawnGem(world, 455, 500, 2);
  assert.equal(gemSystem(world, player, dt), 5);
  assert.equal(world.kind[a], KIND.NONE);
  assert.equal(world.kindCount[KIND.GEM], 0);
});

test('an uncollected gem expires', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 10, 10, 1);
  gemSystem(world, player, GEM_LIFE + 1);
  assert.equal(world.kind[g], KIND.NONE);
});

const dist = (world, player, g) => Math.hypot(world.x[g] - player.x, world.y[g] - player.y);
const angle = (world, player, g) => Math.atan2(world.y[g] - player.y, world.x[g] - player.x);

test('a captured gem eases in: its first step is shorter than a later one', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 430, 1); // 70 away
  const d0 = dist(world, player, g);
  gemSystem(world, player, dt);
  const first = d0 - dist(world, player, g);
  for (let k = 0; k < 8; k++) gemSystem(world, player, dt);
  const before = dist(world, player, g);
  gemSystem(world, player, dt);
  const later = before - dist(world, player, g);
  assert.ok(first < 360 * dt * 0.6, `first step ${first}`);
  assert.ok(later > first * 1.5, `later step ${later}`);
});

test('the radial pull is never slower than 1.5x a fast player once at full speed', () => {
  const { world, player } = setup();
  player.stats.moveSpeed = 500; // 1.5x = 750 px/s, above the 360 floor
  const g = spawnGem(world, 450, 440, 1);
  gemSystem(world, player, dt);
  for (let k = 0; k < 20 && world.kind[g] === KIND.GEM; k++) {
    const before = dist(world, player, g);
    gemSystem(world, player, dt);
    if (world.kind[g] === KIND.GEM && world.cd[g] > 0.2) assert.ok(before - dist(world, player, g) >= 750 * dt * 0.99);
  }
});

test('a captured gem spirals: it turns around the player while closing in, one direction for every gem', () => {
  const { world, player } = setup();
  const a = spawnGem(world, 450, 430, 1); // above
  const b = spawnGem(world, 500, 480, 1); // upper right
  const a0 = angle(world, player, a);
  const b0 = angle(world, player, b);
  let turnA = 0;
  let turnB = 0;
  let prevA = a0;
  let prevB = b0;
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  for (let k = 0; k < 6; k++) {
    gemSystem(world, player, dt);
    turnA += wrap(angle(world, player, a) - prevA);
    turnB += wrap(angle(world, player, b) - prevB);
    prevA = angle(world, player, a);
    prevB = angle(world, player, b);
  }
  assert.ok(Math.abs(turnA) > 0.5, `turned ${turnA}`);
  assert.equal(Math.sign(turnA), Math.sign(turnB));
  assert.ok(dist(world, player, a) < 70);
});

test('the rotation keeps length: a turn alone does not push the gem outward', () => {
  const { world, player } = setup();
  player.stats.pickupRadius = 80;
  const g = spawnGem(world, 450, 440, 1); // 60 away
  let d = dist(world, player, g);
  for (let k = 0; k < 8 && world.kind[g] === KIND.GEM; k++) {
    gemSystem(world, player, dt);
    if (world.kind[g] !== KIND.GEM) break;
    assert.ok(dist(world, player, g) < d, `distance grew from ${d} to ${dist(world, player, g)}`);
    d = dist(world, player, g);
  }
});

test('a captured gem stays captured when the player outruns the pickup radius', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 440, 1);
  gemSystem(world, player, dt);
  player.y = 700; // far beyond reach (80)
  const d = dist(world, player, g);
  gemSystem(world, player, dt);
  assert.ok(world.cd[g] > dt);
  assert.ok(dist(world, player, g) < d);
});

test('every gem in reach is collected within a second from any angle, for a still or moving player', () => {
  for (const moveX of [0, 220]) {
    const world = new World(64);
    const player = createPlayer(450, 500);
    const reach = player.stats.pickupRadius;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      spawnGem(world, 450 + Math.cos(a) * (reach * 0.85), 500 + Math.sin(a) * (reach * 0.85), 1);
    }
    let xp = 0; // the ring sits at 85% of reach so a moving player does not leave it before capture
    for (let t = 0; t < 60 && xp < 24; t++) {
      player.x += moveX * dt;
      xp += gemSystem(world, player, dt);
    }
    assert.equal(xp, 24, `moveX ${moveX}: collected ${xp} of 24`);
  }
});

test('gem motion is deterministic: two identical runs end in identical positions', () => {
  const run = () => {
    const world = new World(16);
    const player = createPlayer(450, 500);
    for (let k = 0; k < 8; k++) spawnGem(world, 400 + k * 12, 440 + (k % 3) * 9, 1);
    for (let t = 0; t < 20; t++) gemSystem(world, player, dt);
    return [...world.x.slice(0, 8), ...world.y.slice(0, 8)].join(',');
  };
  assert.equal(run(), run());
});
