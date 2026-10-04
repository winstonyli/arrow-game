import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND } from '../src/core/world.ts';
import { collisionSystem } from '../src/core/systems.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { createGame } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { orbitSystem, bladePos } from '../src/game/orbit.ts';
import { hitEnemy } from '../src/game/hit.ts';
import { seeded } from '../src/core/math.ts';
import type { Game } from '../src/game/game.ts';

const arenaGame = () => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const settle = (g: Game) => g.grid.rebuild(g.world, KIND.ENEMY);
const at = (g: Game, dx: number, dy = 0) => spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + dx, g.player.y + dy);

test('hitEnemy counts a kill once, calls onKill before the despawn, and rejects a stale slot', () => {
  const g = arenaGame();
  const seen: number[] = [];
  g.onKill = (j) => seen.push(g.world.kind[j]);
  const j = at(g, 100);
  assert.equal(hitEnemy(g, j, 1, 0, 0, 0), 0);
  assert.equal(hitEnemy(g, j, 1e6, 0, 0, 0), 1);
  assert.deepEqual(seen, [KIND.ENEMY]);
  const free = g.world.freeCount;
  g.world.hp[j] = 0; // as a slot killed earlier in the tick: stale, hp <= 0
  assert.equal(hitEnemy(g, j, 1e6, 0, 0, 0), 0);
  assert.equal(seen.length, 1);
  assert.equal(g.world.freeCount, free);
});

test('collisionSystem sends an arrow hit through the hit callback with the arrow velocity', () => {
  const g = arenaGame();
  const e = at(g, 100);
  const a = g.world.spawn(KIND.PROJECTILE, g.player.x + 100, g.player.y, 300, 20, 4, 0);
  g.world.damage[a] = 7;
  g.world.life[a] = 5;
  settle(g);
  const calls: number[][] = [];
  const kills = collisionSystem(g.world, g.grid, g.player, null, (j, dmg, dx, dy) => { calls.push([j, dmg, dx, dy]); return 1; });
  assert.deepEqual(calls, [[e, 7, 300, 20]]);
  assert.equal(kills, 1);
});

test('orbitSystem sends a blade tick through the hit callback with the rate damage', () => {
  const g = arenaGame();
  g.player.stats.orbit = 1;
  g.player.stats.bladeDps = 30;
  g.player.stats.damageMult = 2;
  const pos = { x: 0, y: 0 };
  bladePos(g.player, 0, 0, pos);
  const e = spawnEnemy(g.world, ENEMY.BRUISER, pos.x, pos.y);
  settle(g);
  const calls: number[][] = [];
  orbitSystem(g.world, g.grid, g.player, 0, 0.1, null, (j, dmg) => { calls.push([j, dmg]); return 0; });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], e);
  assert.ok(Math.abs(calls[0][1] - 6) < 1e-9); // 30 * 2 * 0.1
});
