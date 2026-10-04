import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, choose } from '../src/game/game.js';
import { createArena, ARENA_BOUNDS, xpFor, clock } from '../src/modes/arena.js';
import { createRooms } from '../src/modes/rooms.js';
import { seeded } from '../src/core/math.js';
import { KIND } from '../src/core/world.js';
import { SKILLS } from '../src/game/skills.js';
import { hudModel, resultOf, overModel, bestLine, BOSS_BANNER_S, challengeRows, importError, pastedCode } from '../src/ui/model.js';
import { toCode, fromCode, ReplayError } from '../src/replay/codec.js';
import { fakeReplay } from '../scripts/lib/fake-replay.js';
import { icon } from '../src/ui/icons.js';

const arena = () => createGame({ capacity: 2000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const rooms = (o) => createGame({ capacity: 1000, mode: createRooms(o), rng: seeded(1), input: { x: 0, y: 0 } });

test('clock formats m:ss', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(61.9), '1:01');
  assert.equal(clock(600), '10:00');
});

test('arena hud model', () => {
  const g = arena();
  g.player.hp = 50;
  g.xp = xpFor(g.level) / 2;
  g.time = 125;
  g.kills = 7;
  g.offer = ['multishot'];
  choose(g, 'multishot');
  const m = hudModel(g, 'arena');
  assert.equal(m.kind, 'arena');
  assert.equal(m.hpPct, 50);
  assert.equal(m.hp, 50);
  assert.equal(m.level, 1);
  assert.equal(m.xpPct, 50);
  assert.equal(m.time, '2:05');
  assert.equal(m.kills, 7);
  assert.deepEqual(m.skills, [{ id: 'multishot', count: 1 }]);
  assert.equal(m.boss, false);
});

test('hp never shows below zero', () => {
  const g = arena();
  g.player.hp = -5;
  const m = hudModel(g, 'arena');
  assert.equal(m.hpPct, 0);
  assert.equal(m.hp, 0);
});

test('boss banner window', () => {
  const g = arena();
  g.time = 200;
  g.bossAt = 200 - BOSS_BANNER_S + 0.1;
  assert.equal(hudModel(g, 'arena').boss, true);
  g.bossAt = 200 - BOSS_BANNER_S - 0.1;
  assert.equal(hudModel(g, 'arena').boss, false);
});

test('rooms hud model', () => {
  const g = rooms({ bossEvery: 1 });
  const m = hudModel(g, 'rooms');
  assert.equal(m.kind, 'rooms');
  assert.equal(m.room, 1);
  assert.equal(m.bossRoom, true);
  assert.equal(m.enemies, g.world.kindCount[KIND.ENEMY]);
  assert.equal(hudModel(rooms(), 'rooms').bossRoom, false);
});

test('result and over model for arena', () => {
  const g = arena();
  g.time = 187;
  g.kills = 412;
  g.level = 8;
  assert.deepEqual(resultOf(g, 'arena'), { time: 187, kills: 412 });
  const rec = { best: { time: 250, kills: 412 }, isNew: { time: false, kills: true } };
  const o = overModel(g, 'arena', rec);
  assert.equal(o.title, 'Game over');
  assert.deepEqual(o.rows, [['Survived', '3:07'], ['Level', '8'], ['Kills', '412'], ['Best time', '4:10']]);
  assert.deepEqual(o.newBest, ['New best kills']);
});

test('over model for rooms and without records', () => {
  const g = rooms();
  g.mode.room = 7;
  g.kills = 30;
  assert.deepEqual(resultOf(g, 'rooms'), { room: 7 });
  const o = overModel(g, 'rooms', { best: { room: 7 }, isNew: { room: true } });
  assert.deepEqual(o.rows, [['Room reached', '7'], ['Kills', '30'], ['Best room', '7']]);
  assert.deepEqual(o.newBest, ['New best room']);
  assert.deepEqual(overModel(g, 'rooms', null).rows, [['Room reached', '7'], ['Kills', '30']]);
});

test('bestLine for the title screen', () => {
  assert.equal(bestLine('arena', { time: 252, kills: 412 }), 'Best 4:12 / 412 kills');
  assert.equal(bestLine('rooms', { room: 9 }), 'Best room 9');
  assert.equal(bestLine('arena', {}), 'No runs yet');
});

test('every skill and HUD glyph has an icon', () => {
  for (const { id } of SKILLS) assert.match(icon(id), /^<svg /, id);
  for (const id of ['heart', 'skull', 'pause']) assert.match(icon(id), /^<svg /, id);
  assert.throws(() => icon('nope'), /unknown icon/);
});

test('hudModel shows the ghost comparison (arena) and omits it without a ghost', () => {
  const g = Object.assign(arena(), { kills: 10, level: 3, ghost: { x: 0, y: 0, alive: true, level: 4, kills: 7, room: 0 } });
  assert.deepEqual(hudModel(g, 'arena').ghost, { text: 'Ghost Lv 4 · 7 kills (+3)', ahead: true });
  g.kills = 5;
  assert.deepEqual(hudModel(g, 'arena').ghost, { text: 'Ghost Lv 4 · 7 kills (-2)', ahead: false });
  g.ghost.alive = false;
  assert.equal(hudModel(g, 'arena').ghost.text, 'Ghost (out) Lv 4 · 7 kills (-2)');
  delete g.ghost;
  assert.equal(hudModel(g, 'arena').ghost, undefined);
});

test('hudModel ghost line in rooms compares rooms', () => {
  const g = rooms();
  g.mode.room = 5;
  g.ghost = { x: 0, y: 0, alive: true, level: 1, kills: 0, room: 4 };
  assert.deepEqual(hudModel(g, 'rooms').ghost, { text: 'Ghost room 4 (+1)', ahead: true });
});

test('challengeRows summarize stored replays', () => {
  const rows = challengeRows([
    { mode: 'arena', seed: 7, label: 'Daily 2026-10-03', time: 125, kills: 40, level: 5, room: 0, stale: false },
    { mode: 'rooms', seed: 9, label: '', time: 50, kills: 12, level: 1, room: 6, stale: true },
  ]);
  assert.deepEqual(rows[0], { mode: 'arena', seed: 7, title: 'Arena · Daily 2026-10-03', line: '2:05 · 40 kills', stale: false });
  assert.deepEqual(rows[1], { mode: 'rooms', seed: 9, title: 'Rooms · Seed 9', line: 'Room 6 · 12 kills', stale: true });
});

test('importError maps codes to messages with a fallback', () => {
  assert.match(importError('version'), /different game version/);
  assert.match(importError('bad-code'), /not a replay code/);
  assert.match(importError(undefined), /Could not import/);
});

test('pastedCode drops all whitespace, so wrapped or indented codes still import', async () => {
  const r = fakeReplay({ picks: [[2, 'power']] });
  const code = await toCode(r);
  const wrapped = `  ${code.slice(0, 7)}
${code.slice(7, 15)}
	${code.slice(15)} 
`;
  await assert.rejects(fromCode(wrapped), (e) => e instanceof ReplayError && e.code === 'bad-code'); // why the import strips
  assert.equal(pastedCode(wrapped), code);
  assert.deepEqual(await fromCode(pastedCode(wrapped)), r);
  assert.equal(pastedCode(undefined), '');
});
