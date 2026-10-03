import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, choose } from '../src/game/game.js';
import { createRooms } from '../src/modes/rooms.js';
import { KIND } from '../src/core/world.js';
import { ENEMY } from '../src/game/enemies.js';
import { baseStats } from '../src/game/player.js';
import { applySkill } from '../src/game/skills.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const make = () => createGame({ capacity: 1000, mode: createRooms(), rng: seeded(1), input: { x: 0, y: 0 } });
function killAll(game) {
  const w = game.world;
  for (let i = 0; i < w.high; i++) if (w.kind[i] === KIND.ENEMY) w.despawn(i);
}

test('room 1 spawns 6 enemies', () => {
  const g = make();
  assert.equal(g.mode.room, 1);
  assert.equal(g.world.kindCount[KIND.ENEMY], 6);
});

test('clearing a room offers three skills and pauses the simulation', () => {
  const g = make();
  killAll(g);
  tick(g, 1 / 60);
  assert.equal(g.offer.length, 3);
  g.input.x = 1;
  const px = g.player.x;
  tick(g, 1 / 60);
  assert.equal(g.player.x, px);
});

test('choosing a skill applies it and starts the next, bigger room', () => {
  const g = make();
  g.player.hp = 50;
  killAll(g);
  tick(g, 1 / 60);
  const pick = g.offer[0];
  choose(g, pick);
  assert.equal(g.offer, null);
  assert.equal(g.mode.room, 2);
  assert.equal(g.world.kindCount[KIND.ENEMY], 8);
  assert.equal(g.player.hp, 65);
  assert.equal(g.player.x, g.bounds.w / 2);
});

test('every 10th room has exactly one boss', () => {
  const g = make();
  killAll(g);
  g.mode.room = 9;
  g.mode.nextRoom(g);
  let bosses = 0;
  for (let i = 0; i < g.world.high; i++) {
    if (g.world.kind[i] === KIND.ENEMY && g.world.type[i] === ENEMY.BOSS) bosses++;
  }
  assert.equal(g.mode.room, 10);
  assert.equal(bosses, 1);
});

test('player death ends the game', () => {
  const g = make();
  g.player.hp = 0;
  tick(g, 1 / 60);
  assert.equal(g.over, true);
});

test('a standing player auto-kills enemies', () => {
  const g = make();
  for (let i = 0; i < 60 * 5; i++) tick(g, 1 / 60);
  assert.ok(g.kills > 0, `kills=${g.kills}`);
});

test('choose ignores repeats and ids not on offer', () => {
  const g = make();
  killAll(g);
  tick(g, 1 / 60);
  const id = g.offer[0];
  choose(g, id);
  choose(g, id);
  assert.equal(g.mode.room, 2);
  assert.equal(g.world.kindCount[KIND.ENEMY], 8);
  const expected = baseStats();
  applySkill(expected, id);
  assert.deepEqual(g.player.stats, expected);
  assert.equal(g.offer, null);
  const before = g.player.stats.projectileCount;
  choose(g, 'multishot');
  assert.equal(g.player.stats.projectileCount, before);
});

test('death on the clearing tick ends the game without an offer', () => {
  const g = make();
  killAll(g);
  g.player.hp = 0;
  tick(g, 1 / 60);
  assert.equal(g.over, true);
  assert.equal(g.offer, null);
});

test('createGame sets a view and centres the camera inside a larger world', () => {
  const g = createGame({ capacity: 1000, bounds: { w: 3000, h: 2000 }, mode: createRooms(), rng: seeded(1), input: { x: 0, y: 0 } });
  assert.deepEqual(g.view, { w: 900, h: 600 });
  assert.deepEqual(g.camera, { x: 1050, y: 1400 }); // player at (1500, 1920)
  const rooms = make();
  assert.deepEqual(rooms.camera, { x: 0, y: 0 });
});
