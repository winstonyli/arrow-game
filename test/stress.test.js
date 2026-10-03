import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../src/game/game.js';
import { createStress } from '../src/modes/stress.js';
import { seeded } from '../src/core/math.js';
import { KIND } from '../src/core/world.js';
import { ENEMY } from '../src/game/enemies.js';

const make = (opts) =>
  createGame({ capacity: 5000, mode: createStress({ enemies: 200, projectiles: 300, ...opts }), rng: seeded(1), input: { x: 0, y: 0 } });

test('stress mode spawns the requested populations', () => {
  const g = make();
  assert.equal(g.world.kindCount[KIND.ENEMY], 200);
  assert.equal(g.world.kindCount[KIND.PROJECTILE], 300);
});

test('populations stay topped up and the player survives chasers', () => {
  const g = make({ enemyType: ENEMY.CHASER });
  for (let k = 0; k < 600; k++) tick(g, 1 / 60);
  assert.equal(g.world.kindCount[KIND.ENEMY], 200);
  assert.equal(g.world.kindCount[KIND.PROJECTILE], 300);
  assert.equal(g.over, false);
  assert.equal(g.world.dropped, 0);
});

test('dummy enemies do not move', () => {
  const g = make();
  const xs = Array.from(g.world.x.slice(0, 200));
  for (let k = 0; k < 60; k++) tick(g, 1 / 60);
  assert.deepEqual(Array.from(g.world.x.slice(0, 200)), xs);
});

test('seeded is deterministic and in [0, 1)', () => {
  const a = seeded(7);
  const b = seeded(7);
  for (let k = 0; k < 100; k++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
