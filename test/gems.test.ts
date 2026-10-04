import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { createPlayer, movePlayer } from '../src/game/player.ts';
import { moveSystem } from '../src/core/systems.ts';
import { spawnGem, gemSystem, GEM_LIFE } from '../src/game/gems.ts';

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

test('a gem inside the pickup radius is captured and set moving without being collected', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 450, 1); // 50 away, straight above
  assert.equal(gemSystem(world, player, dt), 0);
  assert.ok(world.cd[g] > 0);
  assert.ok(world.vy[g] > 0 && Math.abs(world.vx[g]) > 0); // pulled toward the player, with a sideways swing
  assert.equal(world.kind[g], KIND.GEM);
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

// One tick of the real order: the player moves (and has a velocity), then moveSystem, then gemSystem.
const tick = (world, player, vx = 0) => {
  player.vx = vx;
  player.x += vx * dt;
  moveSystem(world, dt);
  return gemSystem(world, player, dt);
};
const dist = (world, player, g) => Math.hypot(world.x[g] - player.x, world.y[g] - player.y);
const angle = (world, player, g) => Math.atan2(world.y[g] - player.y, world.x[g] - player.x);
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));

test('a captured gem eases in: speed builds up from the capture instant', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 440, 1); // 60 away
  gemSystem(world, player, dt);
  const speeds = [];
  for (let k = 0; k < 8; k++) {
    speeds.push(Math.hypot(world.vx[g], world.vy[g]));
    tick(world, player);
  }
  assert.ok(speeds[0] < speeds[4], `speeds ${speeds.map((v) => v.toFixed(0))}`);
});

test('gems never move absurdly fast: peak speed stays under 500 px/s for a still player', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 421, 1); // at the edge of the pickup radius
  let peak = 0;
  for (let k = 0; k < 60 && world.kind[g] === KIND.GEM; k++) {
    tick(world, player);
    peak = Math.max(peak, Math.hypot(world.vx[g], world.vy[g]));
  }
  assert.ok(peak < 500, `peak ${peak}`);
});

test('a captured gem swings around the player while closing in, one direction for every gem', () => {
  const { world, player } = setup();
  const a = spawnGem(world, 450, 430, 1); // above
  const b = spawnGem(world, 500, 480, 1); // upper right
  let prevA = angle(world, player, a);
  let prevB = angle(world, player, b);
  let turnA = 0;
  let turnB = 0;
  for (let k = 0; k < 12; k++) {
    tick(world, player);
    turnA += wrap(angle(world, player, a) - prevA);
    turnB += wrap(angle(world, player, b) - prevB);
    prevA = angle(world, player, a);
    prevB = angle(world, player, b);
  }
  assert.ok(Math.abs(turnA) > 0.4, `turned ${turnA}`);
  assert.equal(Math.sign(turnA), Math.sign(turnB));
  assert.ok(dist(world, player, a) < 60);
});

test('a captured gem stays captured when the player outruns the pickup radius', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 440, 1);
  gemSystem(world, player, dt);
  player.y = 700; // far beyond reach (80)
  const d = dist(world, player, g);
  tick(world, player);
  assert.ok(world.cd[g] > dt);
  assert.ok(dist(world, player, g) < d + 1); // still being pulled in, not released
});

test('every gem in reach is collected within two seconds from any angle, for still, walking and fast players', () => {
  for (const vx of [0, 220, 500]) {
    const world = new World(64);
    const player = createPlayer(450, 500);
    player.stats.moveSpeed = Math.max(220, vx);
    const reach = player.stats.pickupRadius;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      spawnGem(world, 450 + Math.cos(a) * (reach * 0.85), 500 + Math.sin(a) * (reach * 0.85), 1);
    }
    let xp = 0; // the ring sits at 85% of reach so a moving player does not leave it before capture
    for (let t = 0; t < 120 && xp < 24; t++) xp += tick(world, player, vx);
    assert.equal(xp, 24, `vx ${vx}: collected ${xp} of 24`);
  }
});

test('movePlayer records the velocity it actually travelled, zero when blocked or still', () => {
  const player = createPlayer(450, 500);
  const bounds = { w: 900, h: 1000 };
  movePlayer(player, { x: 1, y: 0 }, dt, bounds);
  assert.ok(Math.abs(player.vx - player.stats.moveSpeed) < 1e-6);
  movePlayer(player, { x: 0, y: 0 }, dt, bounds);
  assert.equal(player.vx, 0);
  player.x = bounds.w - player.radius; // against the wall
  movePlayer(player, { x: 1, y: 0 }, dt, bounds);
  assert.equal(player.vx, 0);
});

test('gem motion is deterministic: two identical runs end in identical positions', () => {
  const run = () => {
    const world = new World(16);
    const player = createPlayer(450, 500);
    for (let k = 0; k < 8; k++) spawnGem(world, 400 + k * 12, 440 + (k % 3) * 9, 1);
    for (let t = 0; t < 20; t++) tick(world, player, t < 10 ? 100 : 0);
    return [...world.x.slice(0, 8), ...world.y.slice(0, 8)].join(',');
  };
  assert.equal(run(), run());
});
