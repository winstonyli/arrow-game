import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS, spawnRate, xpFor, spawnPoint, BOSS_EVERY, BASE_RATE, RATE_PER_SEC } from '../src/modes/arena.ts';
import { KIND } from '../src/core/world.ts';
import { ENEMY, ENEMY_TYPES, spawnEnemy } from '../src/game/enemies.ts';
import { seeded } from '../src/core/math.ts';
import type { Game } from '../src/game/game.ts';

const make = (seed = 1) =>
  createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(seed), input: { x: 0, y: 0 } });
const dt = 1 / 60;
function enemies(g: Game) {
  const out: number[] = [];
  for (let i = 0; i < g.world.high; i++) if (g.world.kind[i] === KIND.ENEMY) out.push(i);
  return out;
}

test('the player starts at the world centre with the camera on it', () => {
  const g = make();
  assert.equal(g.player.x, 1500);
  assert.equal(g.player.y, 1000);
  assert.deepEqual(g.camera, { x: 1050, y: 700 });
  assert.equal(g.level, 1);
});

test('the spawn rate ramps with time', () => {
  assert.ok(spawnRate(100) > spawnRate(0));
});

test('the director spawns about the integral of the rate over the first 5 s', () => {
  const g = make();
  for (let k = 0; k < 300; k++) {
    g.time += dt;
    g.mode.update(g, dt);
  }
  assert.equal(enemies(g).length, Math.floor(BASE_RATE * 5 + (RATE_PER_SEC * 25) / 2));
});

test('spawns land outside the view and inside the world, in the open and near a corner', () => {
  for (const [px, py] of [[1500, 1000], [50, 50], [2950, 1950]]) {
    const g = make(7);
    g.player.x = px;
    g.player.y = py;
    g.camera.x = Math.max(0, Math.min(ARENA_BOUNDS.w - g.view.w, px - g.view.w / 2));
    g.camera.y = Math.max(0, Math.min(ARENA_BOUNDS.h - g.view.h, py - g.view.h / 2));
    g.time = 1000; // ~21 enemies per second
    for (let k = 0; k < 5; k++) g.mode.update(g, 1);
    const list = enemies(g);
    assert.ok(list.length > 20, `spawned ${list.length} near ${px},${py}`);
    for (const i of list) {
      const x = g.world.x[i];
      const y = g.world.y[i];
      assert.ok(x >= 0 && x <= ARENA_BOUNDS.w && y >= 0 && y <= ARENA_BOUNDS.h, 'inside the world');
      const inView = x >= g.camera.x && x <= g.camera.x + g.view.w && y >= g.camera.y && y <= g.camera.y + g.view.h;
      assert.equal(inView, false, 'outside the view');
    }
  }
});

test('spawnPoint reports failure instead of spawning in view when nothing fits', () => {
  const g = make();
  g.rng = () => 0; // always angle 0 at the ring's inner distance, i.e. straight right of the player
  g.player.x = 2900; // that point is past the world's right wall
  const out = { x: 0, y: 0 };
  assert.equal(spawnPoint(g, out), false);
});

test('spawnPoint keeps the whole enemy off screen when the camera is clamped at a wall', () => {
  const g = make();
  g.player.x = 50;
  g.player.y = 50;
  g.camera.x = 0;
  g.camera.y = 0;
  const out = { x: 0, y: 0 };
  for (let k = 0; k < 300; k++) {
    if (!spawnPoint(g, out)) continue;
    assert.ok(out.x > g.view.w + 40 || out.y > g.view.h + 40, 'centre is at least 40px past the view edge');
  }
});

test('a boss spawns every BOSS_EVERY seconds', () => {
  const g = make();
  g.time = BOSS_EVERY;
  g.mode.update(g, dt);
  const bosses = enemies(g).filter((i) => g.world.type[i] === ENEMY.BOSS);
  assert.equal(bosses.length, 1);
  g.mode.update(g, dt);
  assert.equal(enemies(g).filter((i) => g.world.type[i] === ENEMY.BOSS).length, 1); // not again until 2x
});

test('enough XP levels up and offers three skills; the surplus carries over', () => {
  const g = make();
  g.xp = xpFor(1) + 3;
  g.mode.update(g, dt);
  assert.equal(g.level, 2);
  assert.equal(g.xp, 3);
  assert.equal(g.offer!.length, 3);
});

test('onKill drops a gem worth the enemy type XP at its position', () => {
  const g = make();
  const e = spawnEnemy(g.world, ENEMY.SHOOTER, 321, 654);
  g.mode.onKill(g, e);
  let gem = -1;
  for (let i = 0; i < g.world.high; i++) if (g.world.kind[i] === KIND.GEM) gem = i;
  assert.ok(gem >= 0);
  assert.equal(g.world.x[gem], 321);
  assert.equal(g.world.y[gem], 654);
  assert.equal(g.world.damage[gem], ENEMY_TYPES[ENEMY.SHOOTER].xp);
});

test('killing an enemy through tick leaves a gem or XP', () => {
  const g = make(3);
  g.player.hp = g.player.maxHp = 1e9;
  spawnEnemy(g.world, ENEMY.CHASER, g.player.x, g.player.y - 300);
  for (let k = 0; k < 400 && g.kills === 0; k++) tick(g, dt);
  assert.ok(g.kills >= 1);
  assert.ok(g.world.kindCount[KIND.GEM] + g.xp > 0);
});

test('hud and summary describe the run', () => {
  const g = make();
  assert.match(g.mode.hud(g), /Lv 1/);
  assert.match(g.mode.summary(g), /level 1/);
});

test('a boss spawn stamps bossAt with the game time', () => {
  const g = make();
  assert.equal(g.bossAt, -Infinity);
  g.time = BOSS_EVERY;
  g.mode.update(g, dt);
  assert.equal(g.bossAt, BOSS_EVERY);
});
