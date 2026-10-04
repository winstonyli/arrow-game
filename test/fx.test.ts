import test from 'node:test';
import assert from 'node:assert/strict';
import { World, KIND } from '../src/core/world.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { createFx, FLASH_TIME, POOL, RING, DOT, PAL_GEM, PAL_WHITE, PAL_DUST } from '../src/render/fx.ts';
import { createGame, tick, choose } from '../src/game/game.ts';
import { createRooms } from '../src/modes/rooms.ts';
import { createArena, BOSS_EVERY } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import type { Fx } from '../src/render/fx.ts';
import type { Game } from '../src/game/game.ts';
import type { Player } from '../src/game/player.ts';

const mk = () => {
  const world = new World(20);
  const fx = createFx(20, () => 0.5);
  // Stubs: observe and vignette read only these fields, so the full Player/Game are not built (one cast each).
  const player = { hp: 100, maxHp: 100, x: 0, y: 0, stats: { orbit: 0 } } as Player;
  return { world, fx, player, game: { world, player, time: 0 } as Game };
};
const live = (fx: Fx) => {
  let n = 0;
  for (let k = 0; k < POOL; k++) if (fx.p.life[k] > 0) n++;
  return n;
};

test('observe flashes an enemy whose hp dropped, not a fresh spawn, and the flash expires', () => {
  const { world, fx, game } = mk();
  const i = spawnEnemy(world, ENEMY.CHASER, 10, 10);
  fx.observe(game);
  assert.equal(fx.flashing(i), false);
  world.hp[i] -= 5;
  fx.observe(game);
  assert.equal(fx.flashing(i), true);
  fx.update(FLASH_TIME + 0.01);
  assert.equal(fx.flashing(i), false);
});

test("a recycled slot does not inherit the previous occupant's hp or flash", () => {
  const { world, fx, game } = mk();
  const a = spawnEnemy(world, ENEMY.BOSS, 10, 10); // hp 600
  fx.observe(game);
  world.despawn(a);
  const b = spawnEnemy(world, ENEMY.CHASER, 20, 20); // hp 20, same slot
  assert.equal(b, a);
  fx.observe(game);
  assert.equal(fx.flashing(b), false);
});

test('kill spawns one ring and five dots that expire; burst spawns five gold dots', () => {
  const { fx } = mk();
  fx.kill(1, 2, 10, 0);
  assert.equal(live(fx), 6);
  let rings = 0;
  for (let k = 0; k < POOL; k++) if (fx.p.life[k] > 0 && fx.p.shape[k] === RING) rings++;
  assert.equal(rings, 1);
  fx.update(1);
  assert.equal(live(fx), 0);
  fx.burst(1, 2);
  assert.equal(live(fx), 5);
  for (let k = 0; k < POOL; k++) if (fx.p.life[k] > 0) assert.ok(fx.p.shape[k] === DOT && fx.p.pal[k] === PAL_GEM);
});

test('crit is a white ring plus sparks; push is dust that drifts against the push and ignores a zero vector', () => {
  const { fx } = mk();
  fx.crit(5, 6);
  assert.equal(live(fx), 7);
  for (let k = 0; k < POOL; k++) if (fx.p.life[k] > 0) assert.equal(fx.p.pal[k], PAL_WHITE);
  fx.update(1);
  fx.push(5, 6, 3, 0);
  assert.equal(live(fx), 3);
  for (let k = 0; k < POOL; k++) if (fx.p.life[k] > 0) assert.ok(fx.p.vx[k] < 0 && fx.p.pal[k] === PAL_DUST && fx.p.x[k] === 5);
  fx.update(1);
  fx.push(5, 6, 0, 0);
  assert.equal(live(fx), 0);
});

test('the particle pool overwrites the oldest instead of growing', () => {
  const { fx } = mk();
  for (let k = 0; k < 200; k++) fx.kill(0, 0, 10, 0); // 1200 emits
  assert.equal(live(fx), POOL);
});

test('shake trauma clamps at 1 and decays to a zero offset', () => {
  const { fx } = mk();
  fx.shake(0.8);
  fx.shake(0.8);
  assert.equal(fx.trauma, 1);
  fx.update(0.1);
  assert.ok(fx.sx !== 0 || fx.sy !== 0 || fx.trauma < 1);
  fx.update(10);
  assert.equal(fx.trauma, 0);
  assert.equal(fx.sx, 0);
  assert.equal(fx.sy, 0);
});

test('player damage sets the vignette and adds shake; low hp keeps a pulse', () => {
  const { fx, player, game } = mk();
  fx.observe(game);
  assert.equal(fx.hurt, 0);
  player.hp = 80;
  fx.observe(game);
  assert.equal(fx.hurt, 1);
  assert.ok(Math.abs(fx.trauma - 0.35) < 1e-6);
  assert.ok(fx.vignette(player) > 0.5);
  fx.update(10);
  player.hp = 100;
  assert.equal(fx.vignette(player), 0);
  player.hp = 20;
  assert.ok(fx.vignette(player) > 0.1);
});

test('game.onKill drives fx.kill for any mode; arena also bursts gems and shakes on a boss', () => {
  const fx = createFx(50000, () => 0.5);
  const rooms = createGame({ mode: createRooms(), rng: seeded(1), input: { x: 0, y: 0 }, fx });
  const j = spawnEnemy(rooms.world, ENEMY.CHASER, 100, 100);
  rooms.onKill!(j);
  assert.equal(live(fx), 6);

  const fx2 = createFx(50000, () => 0.5);
  const arena = createGame({ mode: createArena(), bounds: { w: 3000, h: 2000 }, rng: seeded(1), input: { x: 0, y: 0 }, fx: fx2 });
  const k = spawnEnemy(arena.world, ENEMY.CHASER, 1500, 1000);
  arena.onKill!(k);
  assert.equal(live(fx2), 11); // ring + 5 dots + 5 gold
  assert.equal(arena.world.kindCount[KIND.GEM], 1);
  arena.time = BOSS_EVERY;
  arena.mode.update(arena, 1 / 60);
  assert.ok(fx2.trauma >= 0.6);
});

test('fx never changes the simulation: a seeded arena runs identically with and without it', () => {
  const run = (withFx: boolean) => {
    const game = createGame({
      capacity: 5000,
      bounds: { w: 3000, h: 2000 },
      mode: createArena(),
      rng: seeded(3),
      input: { x: 0, y: 0 },
      fx: withFx ? createFx(5000, seeded(99)) : undefined,
    });
    game.player.hp = game.player.maxHp = 1e9; // survive the whole run
    for (let k = 0; k < 1800; k++) {
      if (game.offer) choose(game, game.offer[0]);
      tick(game, 1 / 60);
      if (withFx) {
        game.fx!.observe(game);
        game.fx!.update(1 / 60);
      }
    }
    let h = 0;
    for (let i = 0; i < game.world.high; i++) h += game.world.x[i] * 31 + game.world.y[i] * 17 + game.world.kind[i];
    return [game.kills, game.level, game.world.kindCount[KIND.ENEMY], Math.round(h)];
  };
  const base = run(false);
  assert.ok(base[0] > 0, 'the run must kill something to exercise the hooks');
  assert.deepEqual(run(true), base);
});

test('soft lowers hp without a flash or a counted hit, and a plain drop still flashes and counts', () => {
  const { world, fx, game } = mk();
  const a = spawnEnemy(world, ENEMY.BOSS, 10, 10);
  fx.observe(game);
  world.hp[a] -= 5;
  fx.soft(a, 5);
  fx.observe(game);
  assert.equal(fx.flashing(a), false);
  assert.equal(fx.hits, 0);
  world.hp[a] -= 5;
  fx.observe(game);
  assert.equal(fx.flashing(a), true);
  assert.equal(fx.hits, 1);
});
