import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COVERAGE, HIT_FLAGS, covers } from '../src/game/coverage.ts';
import { HIT_CRIT, HIT_KNOCK, HIT_STATUS, HIT_TICK } from '../src/game/hitflags.ts';
import { WEAPONS } from '../src/game/weapons.ts';
import { MODS } from '../src/game/modifiers.ts';

const C = HIT_CRIT, K = HIT_KNOCK, S = HIT_STATUS, T = HIT_TICK;
// The intended flags per source. Task 1 pins today's behaviour; Task 2 edits this table on purpose.
const EXPECTED: Record<string, number> = { bow: C | K | S, blade: 0, shockwave: C | S, chain: C | K | S, boomerang: 0, flame: S | T, mines: S | K, meteor: S | K, beam: S | T, drone: C | S, daggers: C | S };

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
    assert.ok(!/\bHIT_(CRIT|KNOCK|STATUS|TICK|SHOVE)\b/.test(text), `${f} spells a flag`);
    for (const line of text.split(/\r?\n/)) if (/\bhitEnemy\(game/.test(line)) assert.ok(/HIT_FLAGS\.\w+/.test(line), `${f}: ${line.trim()}`);
  }
});
