import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { applySkill } from '../src/game/skills.ts';
import { stateHash } from '../src/replay/hash.ts';
import { seeded } from '../src/core/math.ts';

// All four weapons and all four modifiers at level 5, an invulnerable drifting player, checkpoints every 20 s.
function run(): number[] {
  const g = createGame({ capacity: 20000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(7), input: { x: 0.6, y: 0.3 } });
  g.player.hp = g.player.maxHp = 1e9;
  for (const id of ['blade', 'shockwave', 'chain', 'boomerang', 'crit', 'knockback', 'explode', 'vamp']) {
    for (let k = 0; k < 5; k++) applySkill(g.player.stats, id);
  }
  const out: number[] = [];
  for (let t = 1; t <= 3600; t++) {
    g.offer = null; // skip level-up pauses: the picks above are the build
    tick(g, 1 / 60);
    if (t % 1200 === 0) out.push(stateHash(g));
  }
  return out;
}

const EXPECTED: number[] = [374674988, 3600650303, 1557452240];

test('a maxed build hashes the same on every run and on both engines', () => {
  const a = run();
  assert.deepEqual(run(), a);
  assert.deepEqual(a, EXPECTED);
});
