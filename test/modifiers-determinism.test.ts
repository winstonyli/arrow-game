import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { applySkill } from '../src/game/skills.ts';
import { stateHash } from '../src/replay/hash.ts';
import { seeded } from '../src/core/math.ts';

// All six weapons and all six modifiers at level 5 (applySkill does not check slots), an invulnerable drifting player, checkpoints every 20 s.
function run(seen?: { slow: boolean; burn: boolean; fire: boolean; mines: boolean }): number[] {
  const g = createGame({ capacity: 20000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(7), input: { x: 0.6, y: 0.3 } });
  g.player.hp = g.player.maxHp = 1e9;
  for (const id of ['blade', 'shockwave', 'chain', 'boomerang', 'flame', 'mines', 'crit', 'knockback', 'explode', 'vamp', 'frost', 'ignite']) {
    for (let k = 0; k < 5; k++) applySkill(g.player.stats, id);
  }
  const out: number[] = [];
  for (let t = 1; t <= 3600; t++) {
    g.offer = null; // skip level-up pauses: the picks above are the build
    tick(g, 1 / 60);
    if (t % 1200 === 0) out.push(stateHash(g));
    if (seen && t % 60 === 0) {
      for (let i = 0; i < g.world.high; i++) {
        if (g.world.slowT[i] > 0) seen.slow = true;
        if (g.world.burnT[i] > 0) seen.burn = true;
      }
      for (let k = 0; k < g.wstate.fire.life.length; k++) if (g.wstate.fire.life[k] > 0) seen.fire = true;
      for (let k = 0; k < g.wstate.mines.on.length; k++) if (g.wstate.mines.on[k] === 1) seen.mines = true;
    }
  }
  return out;
}

const EXPECTED: number[] = [3549097361, 761497525, 3697002078];

test('a maxed build hashes the same on every run and on both engines', () => {
  const a = run();
  assert.deepEqual(run(), a);
  assert.deepEqual(a, EXPECTED);
});

test('the maxed build actually slows and burns enemies and drops fire patches and mines, so the hashes cover them', () => {
  const seen = { slow: false, burn: false, fire: false, mines: false };
  run(seen);
  assert.deepEqual(seen, { slow: true, burn: true, fire: true, mines: true });
});
