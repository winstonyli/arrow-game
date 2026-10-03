import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, tick, choose } from '../src/game/game.js';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.js';
import { createFx } from '../src/render/fx.js';
import { createStepper } from '../src/core/loop.js';
import { seeded } from '../src/core/math.js';

// FNV-1a over the sim state (world arrays, player, scalars). Guards the multiplayer prerequisite: same seed and
// same input script must give the same state, whatever the frame times or presentation attached.
function hash(g) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const num = (x) => {
    f[0] = x;
    mix(u[0]);
  };
  const w = g.world;
  for (let i = 0; i < w.high; i++) {
    mix(w.kind[i]);
    if (!w.kind[i]) continue;
    for (const k of ['x', 'y', 'vx', 'vy', 'hp', 'radius', 'life', 'cd']) num(w[k][i]);
    mix(w.type[i]);
    mix(w.gen[i]);
    mix(w.pierce[i]);
    mix(w.bounce[i]);
  }
  for (const k of ['x', 'y', 'hp', 'cd', 'invuln']) num(g.player[k]);
  num(g.time);
  num(g.xp);
  mix(g.kills);
  mix(g.level);
  mix(w.freeCount);
  mix(w.high);
  mix(w.dropped);
  return h;
}

function run({ seed, seconds, frameDts = [1 / 60], fx }) {
  const input = { x: 0, y: 0 };
  const g = createGame({ capacity: 20000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(seed), input, fx });
  g.player.hp = g.player.maxHp = 1e9;
  const stepper = createStepper();
  const hashes = [];
  let ticks = 0;
  for (let f = 0; ticks < seconds * 60; f++) {
    const n = stepper.advance(frameDts[f % frameDts.length]);
    for (let i = 0; i < n && ticks < seconds * 60; i++, ticks++) {
      const t = ticks / 60;
      input.x = Math.sin(t * 0.7); // scripted: never reads sim state
      input.y = Math.cos(t * 0.45);
      if (g.offer) choose(g, g.offer[0]);
      tick(g, stepper.dt);
      fx?.observe(g);
      fx?.update(stepper.dt);
      if (ticks % 60 === 59) hashes.push(hash(g));
    }
  }
  return hashes;
}

const base = run({ seed: 7, seconds: 40 });

test('the same seed and input script give the same state every second', () => {
  assert.deepEqual(run({ seed: 7, seconds: 40 }), base);
});

test('frame-time jitter does not change the sim (fixed 60 Hz steps)', () => {
  assert.deepEqual(run({ seed: 7, seconds: 40, frameDts: [1 / 144, 1 / 144, 1 / 30, 1 / 75, 1 / 200] }), base);
});

test('attaching fx does not change the sim', () => {
  assert.deepEqual(run({ seed: 7, seconds: 40, fx: createFx(20000, seeded(99)) }), base);
});

test('a different seed diverges (the hash is sensitive)', () => {
  assert.notDeepEqual(run({ seed: 8, seconds: 5 }), base.slice(0, 5));
});
