import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COVERAGE, HIT_FLAGS, covers } from '../src/game/coverage.ts';
import { HIT_CRIT, HIT_KNOCK, HIT_STATUS, HIT_TICK } from '../src/game/hitflags.ts';
import { WEAPONS } from '../src/game/weapons.ts';
import { MODS, KNOCK_PX, FROST_SECS } from '../src/game/modifiers.ts';
import { createGame } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import { KIND } from '../src/core/world.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { applySkill } from '../src/game/skills.ts';
import { updateShockwave } from '../src/game/weapons/shockwave.ts';
import { updateBoomerang } from '../src/game/weapons/boomerang.ts';
import type { Game } from '../src/game/game.ts';

const C = HIT_CRIT, K = HIT_KNOCK, S = HIT_STATUS, T = HIT_TICK;
// The intended flags per source.
const EXPECTED: Record<string, number> = { bow: C | K | S, blade: S, shockwave: C | K | S, chain: C | K | S, boomerang: C | S, flame: S | T, mines: C | S | K, meteor: C | S | K, beam: S | T, drone: C | S, daggers: C | S };

test('the coverage table has the bow and every weapon, and its flags are the intended ones', () => {
  assert.deepEqual(Object.keys(COVERAGE).sort(), ['bow', ...WEAPONS.map((w) => w.id)].sort());
  assert.deepEqual(HIT_FLAGS, EXPECTED);
});

test('tick weapons never crit or knock back, and every entry says why it is the way it is', () => {
  for (const [id, c] of Object.entries(COVERAGE)) {
    if (c.tick) assert.ok(!c.crit && !c.knock, id);
    assert.ok(c.note.length > 0, id);
  }
});

test('covers() maps each modifier to the table; Vampiric and Popcorn act on kills so cover every source', () => {
  for (const id of Object.keys(COVERAGE) as (keyof typeof COVERAGE)[]) {
    assert.equal(covers(id, 'crit'), COVERAGE[id].crit);
    assert.equal(covers(id, 'knockback'), COVERAGE[id].knock);
    assert.equal(covers(id, 'frost'), COVERAGE[id].status);
    assert.equal(covers(id, 'ignite'), COVERAGE[id].status);
    assert.equal(covers(id, 'vamp'), true);
    assert.equal(covers(id, 'explode'), true);
  }
  assert.equal(MODS.length, 6); // covers() has a case per ModKey; add one if a modifier is added
});

test('no weapon file spells a hit flag itself: every hitEnemy call reads HIT_FLAGS', () => {
  const dir = fileURLToPath(new URL('../src/game/weapons/', import.meta.url));
  for (const f of readdirSync(dir)) {
    const text = readFileSync(dir + f, 'utf8');
    // Quake alone imports HIT_SHOVE: a Quake-specific modifier of the table's flags, not a table flag itself.
    const spelled = f === 'shockwave.ts' ? /\bHIT_(CRIT|KNOCK|STATUS|TICK)\b/ : /\bHIT_(CRIT|KNOCK|STATUS|TICK|SHOVE)\b/;
    assert.ok(!spelled.test(text), `${f} spells a flag`);
    for (const line of text.split(/\r?\n/)) if (/\bhitEnemy\(game/.test(line)) assert.ok(/HIT_FLAGS\.\w+/.test(line), `${f}: ${line.trim()}`);
  }
});

const arenaGame = (): Game => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const settle = (g: Game) => g.grid.rebuild(g.world, KIND.ENEMY);

test('Quake pushes a surviving enemy away from the ring origin with Personal Space', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  g.player.stats.knockback = 1;
  const j = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  const x0 = g.world.x[j];
  for (let k = 0; k < 60; k++) { settle(g); updateShockwave(g, 1, 1 / 60); } // a full pulse: one push
  assert.ok(Math.abs(g.world.x[j] - (g.player.x + 100 + KNOCK_PX)) < 1e-2);
  assert.ok(Math.abs(g.world.y[j] - g.player.y) < 1e-2);
});

test('Whirligig hits start Molasses', () => {
  const g = arenaGame();
  g.player.stats.frost = 1;
  const j = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 100, g.player.y);
  g.hits.blade(j, 1, 0, 0);
  assert.equal(g.world.slowT[j], FROST_SECS);
});

test('Yo-Yo hits start Molasses', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'boomerang');
  g.player.stats.frost = 1;
  const j = spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + 80, g.player.y);
  for (let k = 0; k < 120 && g.world.slowT[j] === 0; k++) { settle(g); updateBoomerang(g, 1, 1 / 60); }
  assert.equal(g.world.slowT[j], FROST_SECS);
});
