import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { applySkill } from '../src/game/skills.ts';
import { stateHash } from '../src/replay/hash.ts';
import { seeded } from '../src/core/math.ts';
import { MINE_LIFE } from '../src/game/weapons/mines.ts';
import { BEAM_TICK } from '../src/game/weapons/beam.ts';
import { METEOR_TELEGRAPH } from '../src/game/weapons/meteor.ts';

// Eight weapons (the bow aside) and all six modifiers at level 5 (applySkill does not check slots), an invulnerable drifting player, checkpoints every 20 s.
function run(seen?: { slow: boolean; burn: boolean; fire: boolean; mines: boolean; detonated: boolean; meteors: boolean; struck: boolean; beamed: boolean }): number[] {
  const g = createGame({ capacity: 20000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(7), input: { x: 0.6, y: 0.3 } });
  g.player.hp = g.player.maxHp = 1e9;
  for (const id of ['blade', 'shockwave', 'chain', 'boomerang', 'flame', 'mines', 'meteor', 'beam', 'crit', 'knockback', 'explode', 'vamp', 'frost', 'ignite']) {
    for (let k = 0; k < 5; k++) applySkill(g.player.stats, id);
  }
  const out: number[] = [];
  const mn = g.wstate.mines;
  const prevOn = new Uint8Array(mn.on.length);
  const prevAge = new Float32Array(mn.on.length);
  const mt = g.wstate.meteors;
  const prevMOn = new Uint8Array(mt.on.length);
  const prevMAge = new Float32Array(mt.on.length);
  const bm = g.wstate.beam;
  let prevCd = bm.cd;
  for (let t = 1; t <= 3600; t++) {
    g.offer = null; // skip level-up pauses: the picks above are the build
    if (seen) { prevOn.set(mn.on); prevAge.set(mn.age); prevMOn.set(mt.on); prevMAge.set(mt.age); }
    tick(g, 1 / 60);
    if (seen) {
      // A mine that went away well before MINE_LIFE detonated (expiry does not blast). A slot refilled the same tick shows as a younger age.
      for (let k = 0; k < mn.on.length; k++) {
        if (prevOn[k] === 1 && (mn.on[k] === 0 || mn.age[k] < prevAge[k]) && prevAge[k] + 1 / 60 < MINE_LIFE - 0.1) seen.detonated = true;
      }
    }
    if (seen) {
      // A strike that went off after reaching the telegraph time landed (a slot refilled the same tick shows as a younger age).
      for (let k = 0; k < mt.on.length; k++) {
        if (prevMOn[k] === 1 && (mt.on[k] === 0 || mt.age[k] < prevMAge[k]) && prevMAge[k] + 1 / 60 >= METEOR_TELEGRAPH) seen.struck = true;
      }
    }
    if (seen) {
      // The beam tick timer reloads by BEAM_TICK when a damage tick lands.
      if (bm.cd - prevCd > BEAM_TICK / 2) seen.beamed = true;
      prevCd = bm.cd;
    }
    if (t % 1200 === 0) out.push(stateHash(g));
    if (seen && t % 60 === 0) {
      for (let i = 0; i < g.world.high; i++) {
        if (g.world.slowT[i] > 0) seen.slow = true;
        if (g.world.burnT[i] > 0) seen.burn = true;
      }
      for (let k = 0; k < g.wstate.fire.life.length; k++) if (g.wstate.fire.life[k] > 0) seen.fire = true;
      for (let k = 0; k < g.wstate.mines.on.length; k++) if (g.wstate.mines.on[k] === 1) seen.mines = true;
      for (let k = 0; k < mt.on.length; k++) if (mt.on[k] === 1) seen.meteors = true;
    }
  }
  return out;
}

const EXPECTED: number[] = [3242544587, 1057789969, 3204847702];

test('a maxed build hashes the same on every run and on both engines', () => {
  const a = run();
  assert.deepEqual(run(), a);
  assert.deepEqual(a, EXPECTED);
});

test('the maxed build actually slows and burns enemies and drops fire patches, mines that detonate, meteors that land and a beam that ticks, so the hashes cover them', () => {
  const seen = { slow: false, burn: false, fire: false, mines: false, detonated: false, meteors: false, struck: false, beamed: false };
  run(seen);
  assert.deepEqual(seen, { slow: true, burn: true, fire: true, mines: true, detonated: true, meteors: true, struck: true, beamed: true });
});
