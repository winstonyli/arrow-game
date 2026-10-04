import test from 'node:test';
import assert from 'node:assert/strict';
import { createSfx, MAX_VOICES, MIN_GAP, STREAK_RESET, PENTATONIC } from '../src/audio/sfx.ts';
import { createFx } from '../src/render/fx.js';
import { World } from '../src/core/world.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';

// Records what would play. Voices never end on their own; call ctx.endAll() to finish them.
function fakeCtx() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 100,
    destination: {},
    started: [], // { kind, f0 } per started voice
    live: [],
    createGain: () => ({ gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }),
    createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }),
    createBiquadFilter: () => ({ Q: {}, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    createOscillator() {
      const node = { frequency: { setValueAtTime: (f) => (node.f0 = f), exponentialRampToValueAtTime() {} }, connect() {}, start: () => { ctx.started.push({ kind: 'osc', f0: node.f0 }); ctx.live.push(node); }, stop() {} };
      return node;
    },
    createBufferSource() {
      const node = { connect() {}, start: () => { ctx.started.push({ kind: 'noise' }); ctx.live.push(node); }, stop() {} };
      return node;
    },
    endAll() {
      for (const n of ctx.live.splice(0)) n.onended?.();
    },
    resume() {
      ctx.state = 'running';
    },
  };
  return ctx;
}
const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
};
const oscs = (ctx) => ctx.started.filter((s) => s.kind === 'osc');

test('nothing plays until the context is running (browser autoplay), then it does', () => {
  const ctx = fakeCtx();
  ctx.state = 'suspended';
  const sfx = createSfx(ctx);
  sfx.kill();
  sfx.levelUp();
  assert.equal(ctx.started.length, 0);
  sfx.resume();
  sfx.kill();
  assert.ok(ctx.started.length > 0);
});

test('a sound is throttled to MIN_GAP, then plays again', () => {
  const ctx = fakeCtx();
  const sfx = createSfx(ctx);
  sfx.hit();
  const n = ctx.started.length;
  assert.ok(n > 0);
  sfx.hit();
  assert.equal(ctx.started.length, n); // same instant: dropped
  ctx.currentTime += MIN_GAP.hit + 0.001;
  sfx.hit();
  assert.ok(ctx.started.length > n);
});

test('the voice cap stops new sounds until voices end', () => {
  const ctx = fakeCtx();
  const sfx = createSfx(ctx);
  for (let k = 0; k < MAX_VOICES * 3; k++) {
    ctx.currentTime += 1; // clear every throttle
    sfx.kill();
  }
  assert.ok(ctx.started.length <= MAX_VOICES + 2, `${ctx.started.length} started`); // a sound can overshoot by its own voices
  const capped = ctx.started.length;
  ctx.currentTime += 1;
  sfx.kill();
  assert.equal(ctx.started.length, capped);
  ctx.endAll();
  ctx.currentTime += 1;
  sfx.kill();
  assert.ok(ctx.started.length > capped);
});

test('pickup pitch climbs the scale while pickups keep coming, and restarts after STREAK_RESET', () => {
  const ctx = fakeCtx();
  const sfx = createSfx(ctx);
  const firstOf = () => oscs(ctx).slice(-2)[0].f0; // the main tone of the latest pickup
  sfx.pickup();
  const f0 = firstOf();
  ctx.currentTime += 0.1;
  sfx.pickup();
  const f1 = firstOf();
  ctx.currentTime += 0.1;
  sfx.pickup();
  const f2 = firstOf();
  assert.ok(f1 > f0 && f2 > f1);
  assert.ok(Math.abs(f1 / f0 - 2 ** ((PENTATONIC[1] - PENTATONIC[0]) / 12)) < 1e-9);
  ctx.currentTime += STREAK_RESET + 0.1;
  sfx.pickup();
  assert.ok(Math.abs(firstOf() - f0) < 1e-9);
});

test('heavy kills sound different from light ones', () => {
  const ctx = fakeCtx();
  const sfx = createSfx(ctx);
  sfx.kill(10);
  const light = oscs(ctx)[0].f0;
  ctx.currentTime += 1;
  sfx.kill(36);
  const heavy = oscs(ctx).at(-1).f0;
  assert.ok(heavy < light / 2);
});

test('mute silences everything, persists, and survives a reload', () => {
  const store = memory();
  const ctx = fakeCtx();
  const sfx = createSfx(ctx, store);
  assert.equal(sfx.toggleMute(), true);
  sfx.kill();
  sfx.levelUp();
  sfx.boss();
  sfx.gameOver();
  assert.equal(ctx.started.length, 0);
  assert.equal(createSfx(fakeCtx(), store).muted, true);
  assert.equal(sfx.toggleMute(), false);
  sfx.kill();
  assert.ok(ctx.started.length > 0);
  assert.equal(createSfx(fakeCtx(), store).muted, false);
});

test('a broken storage does not break mute', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const sfx = createSfx(fakeCtx(), bad);
  assert.equal(sfx.muted, false);
  assert.equal(sfx.toggleMute(), true);
});

const stage = () => {
  const world = new World(20);
  const fx = createFx(20, () => 0.5);
  const player = { x: 0, y: 0, hp: 100, maxHp: 100, cd: 0, stats: { orbit: 0 } };
  const game = { world, player, fx, time: 0, xp: 0, level: 1, over: false };
  const ctx = fakeCtx();
  return { world, fx, player, game, ctx, sfx: createSfx(ctx) };
};
const step = (s) => {
  s.ctx.currentTime += 1; // clear throttles so each event can sound
  s.fx.observe(s.game);
  s.sfx.observe(s.game);
};

test('observe: the first call (or a new game) sets baselines and plays nothing', () => {
  const s = stage();
  s.player.cd = 0.5;
  s.game.xp = 7;
  step(s);
  assert.equal(s.ctx.started.length, 0);
  const g2 = { ...s.game, xp: 99, level: 5, over: true, player: { ...s.player, hp: 1 } };
  s.sfx.observe(g2);
  assert.equal(s.ctx.started.length, 0);
});

test('observe: each event plays once, and a quiet frame plays nothing', () => {
  const s = stage();
  const e = spawnEnemy(s.world, ENEMY.CHASER, 10, 10);
  step(s); // baseline
  const count = () => s.ctx.started.length;
  step(s);
  assert.equal(count(), 0);
  s.player.cd = 0.5; // volley fired
  step(s);
  const afterFire = count();
  assert.ok(afterFire > 0);
  s.player.cd = 0.4; // just cooling down
  step(s);
  assert.equal(count(), afterFire);
  s.world.hp[e] -= 3; // hit
  step(s);
  const afterHit = count();
  assert.ok(afterHit > afterFire);
  s.game.xp += 1; // gem picked up
  step(s);
  const afterPickup = count();
  assert.ok(afterPickup > afterHit);
  s.game.level = 2; // level-up (xp drops on the same frame)
  s.game.xp = 0;
  step(s);
  assert.ok(count() >= afterPickup + 4); // a four-note arpeggio, not a pickup blip
  const afterLevel = count();
  s.player.hp -= 10;
  step(s);
  assert.ok(count() > afterLevel);
  const afterHurt = count();
  s.game.over = true;
  step(s);
  assert.ok(count() > afterHurt);
  const afterOver = count();
  step(s);
  assert.equal(count(), afterOver);
});
