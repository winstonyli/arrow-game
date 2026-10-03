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

test('a gem inside the pickup radius drifts toward the player without being collected', () => {
  const { world, player } = setup();
  const g = spawnGem(world, 450, 450, 1); // 50 away
  assert.equal(gemSystem(world, player, dt), 0);
  assert.ok(world.y[g] > 450 && world.y[g] < 500);
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

test('the magnet outpaces a fast player', () => {
  const { world, player } = setup();
  player.stats.moveSpeed = 500; // 1.5x = 750 px/s, above the 360 floor
  const g = spawnGem(world, 450, 440, 1); // 60 away
  gemSystem(world, player, 0.04); // 750*0.04 = 30 px
  assert.ok(Math.abs(world.y[g] - 470) < 1e-3);
});
