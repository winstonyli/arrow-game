import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebGLRenderer, packInstances, STRIDE } from '../src/render/webgl.ts';
import { World, KIND } from '../src/core/world.ts';
import { spawnEnemy, ENEMY, ENEMY_TYPES } from '../src/game/enemies.ts';
import { createFx, POOL } from '../src/render/fx.ts';
import type { Game } from '../src/game/game.ts';
import type { Player, PlayerStats } from '../src/game/player.ts';
import type { RenderGame } from '../src/render/canvas.ts';
import { createWeaponState } from '../src/game/weapons.ts';
import { CHAIN_LIFE } from '../src/game/weapons/chain.ts';
import { BOOM_RADIUS } from '../src/game/weapons/boomerang.ts';
import { WEAPON_INSTANCES, COLORS } from '../src/render/webgl.ts';
import { FLAME_LEVELS, FIRE_ALPHA } from '../src/game/weapons/flame.ts';
import { IGNITE_TINT } from '../src/game/modifiers.ts';

type PlayerStub = Pick<Player, 'x' | 'y' | 'radius' | 'invuln'> & { stats: Pick<PlayerStats, 'orbit' | 'weapons'> };
type PackGame = Pick<RenderGame, 'time' | 'camera' | 'view' | 'fx'> & Partial<Pick<RenderGame, 'wstate'>>;

// Casts: packInstances reads only these player fields, and `fx` may be left out of a game (it reads undefined).
const player = (over: Partial<PlayerStub> = {}) => ({ x: 5, y: 6, radius: 12, invuln: 0, stats: { orbit: 0, weapons: {} }, ...over }) as Player;
const G = (o: Partial<PackGame> = {}) => ({ time: 0, camera: { x: 0, y: 0 }, view: { w: 900, h: 600 }, ...o }) as PackGame;

test('packInstances writes live entities by layer, player last, skipping free slots', () => {
  const w = new World(10);
  const a = spawnEnemy(w, ENEMY.SHOOTER, 1, 2);
  const b = spawnEnemy(w, ENEMY.CHASER, 3, 4);
  w.spawn(KIND.PROJECTILE, 7, 8, 0, 0, 4, 0);
  w.spawn(KIND.ENEMY_PROJECTILE, 9, 10, 0, 0, 5, 0);
  w.despawn(b);
  const out = new Float32Array(11 * STRIDE);
  const n = packInstances(w, player(), G(), out);
  assert.equal(n, 4); // shooter, projectile, enemy projectile, player
  const row = (k: number) => Array.from(out.subarray(k * STRIDE, (k + 1) * STRIDE));
  const T = ENEMY_TYPES.length;
  assert.deepEqual(row(0), [1, 2, ENEMY_TYPES[ENEMY.SHOOTER].radius, ENEMY.SHOOTER, 2, 0, 0, 0, 0]);
  assert.deepEqual(row(1), [9, 10, 5, T, 2, 0, 0, 0, 0]); // enemy projectile, then the player's arrow
  assert.deepEqual(row(2), [7, 8, 4, T + 1, 2, 0, 0, 0, 0]);
  assert.deepEqual(row(3), [5, 6, 12, T + 2, 2, 0, 0, 0, 0]);
  assert.ok(a >= 0);
});

test('player blinks only while invulnerable', () => {
  const w = new World(2);
  const out = new Float32Array(3 * STRIDE);
  const T = ENEMY_TYPES.length;
  packInstances(w, player({ invuln: 0.3 }), G({ time: 0.05 }), out); // floor(0.05*20)=1 -> odd -> blink
  assert.equal(out[3], T + 3);
  packInstances(w, player({ invuln: 0.3 }), G(), out);
  assert.equal(out[3], T + 2);
  packInstances(w, player({ invuln: 0 }), G({ time: 0.05 }), out);
  assert.equal(out[3], T + 2);
});

test('packInstances culls entities fully outside the view but keeps the player', () => {
  const w = new World(10);
  w.spawn(KIND.ENEMY, 2000, 100, 0, 0, 10, 10); // far right: culled
  w.spawn(KIND.ENEMY, 895, 100, 0, 0, 10, 10); // inside
  w.spawn(KIND.ENEMY, -8, 100, 0, 0, 10, 10); // circle reaches x = 2: kept
  w.spawn(KIND.ENEMY, -11, 100, 0, 0, 10, 10); // circle ends at x = -1: culled
  const out = new Float32Array(11 * STRIDE);
  const n = packInstances(w, player({ x: 5000, y: 5000 }), G(), out);
  assert.equal(n, 3); // two enemies + the player
  assert.equal(out[0], 895);
  assert.equal(out[STRIDE], -8);
});

test('packInstances follows the camera', () => {
  const w = new World(4);
  w.spawn(KIND.ENEMY, 2000, 100, 0, 0, 10, 10);
  const out = new Float32Array(5 * STRIDE);
  assert.equal(packInstances(w, player(), G(), out), 1); // player only
  assert.equal(packInstances(w, player(), G({ camera: { x: 1500, y: 0 } }), out), 2);
});

test('gems pack with their own palette index', () => {
  const w = new World(2);
  w.spawn(KIND.GEM, 10, 10, 0, 0, 5, 0);
  const out = new Float32Array(3 * STRIDE);
  packInstances(w, player(), G(), out);
  assert.equal(out[3], ENEMY_TYPES.length + 4);
});

test('a flashing enemy packs the flash palette entry', () => {
  const w = new World(10);
  const a = spawnEnemy(w, ENEMY.CHASER, 100, 100);
  const fx = createFx(10, () => 0.5);
  const sim = { world: w, player: { hp: 100, x: 0, y: 0, stats: { orbit: 0 } }, time: 0 } as Game; // cast: observe reads only these
  const game = G({ fx });
  const out = new Float32Array(20 * STRIDE);
  const T = ENEMY_TYPES.length;
  fx.observe(sim); // baseline
  packInstances(w, player(), game, out);
  assert.equal(out[3], ENEMY.CHASER);
  w.hp[a] -= 1;
  fx.observe(sim); // sees the drop
  packInstances(w, player(), game, out);
  assert.equal(out[3], T + 5); // P_FLASH: after enemy projectile, projectile, player, blink, gem
});

test('slowed and burning enemies pack the ice and fire palette entries, burning winning and a flash beating both', () => {
  const w = new World(10);
  const a = spawnEnemy(w, ENEMY.CHASER, 100, 100);
  const out = new Float32Array(20 * STRIDE);
  const T = ENEMY_TYPES.length;
  const P_WEAPON = T + 7; // enemy projectile, projectile, player, blink, gem, flash, blade, weapon
  const pack = (fx?: ReturnType<typeof createFx>) => {
    packInstances(w, player(), G(fx ? { fx } : {}), out);
    return out[3];
  };
  assert.equal(pack(), ENEMY.CHASER);
  w.slowT[a] = 1;
  assert.equal(pack(), P_WEAPON + 1); // P_SLOW
  w.burnT[a] = 1;
  assert.equal(pack(), P_WEAPON + 2); // P_BURN
  const fx = createFx(10, () => 0.5);
  const sim = { world: w, player: { hp: 100, x: 0, y: 0, stats: { orbit: 0 } }, time: 0 } as Game; // cast: observe reads only these
  fx.observe(sim);
  w.hp[a] -= 1;
  fx.observe(sim);
  assert.equal(pack(fx), T + 5); // flash wins
});

test('particles pack before the player with alpha / negative ring fade', () => {
  const w = new World(10);
  const fx = createFx(10, () => 0.5);
  fx.kill(50, 60, 10, ENEMY.CHASER); // 1 ring + 5 dots
  const out = new Float32Array(20 * STRIDE);
  const n = packInstances(w, player(), G({ fx }), out);
  assert.equal(n, 7); // 6 particles + player
  const fade = (k: number) => out[k * STRIDE + 4];
  assert.ok(fade(0) < 0 && fade(0) >= -1); // the ring is emitted first
  for (let k = 1; k < 6; k++) assert.ok(fade(k) > 0 && fade(k) <= 1);
  assert.equal(fade(6), 2); // player is last and solid
});

test('with fx the cull pad keeps entities just outside the view for shake', () => {
  const w = new World(10);
  spawnEnemy(w, ENEMY.CHASER, -20, 100); // radius 10: right edge at -10, 10 px outside
  const out = new Float32Array(20 * STRIDE);
  assert.equal(packInstances(w, player(), G(), out), 1); // player only
  assert.equal(packInstances(w, player(), G({ fx: createFx(10) }), out), 2);
});

test('layers draw gems, enemies, enemy projectiles, arrows, then particles, blades and the player, whatever the slot order', () => {
  const w = new World(20);
  w.spawn(KIND.PROJECTILE, 1, 0, 0, 0, 4, 0); // slot 0: arrow
  w.spawn(KIND.ENEMY_PROJECTILE, 2, 0, 0, 0, 4, 0);
  spawnEnemy(w, ENEMY.CHASER, 3, 0);
  w.spawn(KIND.GEM, 4, 0, 0, 0, 5, 0); // slot 3: gem
  const fx = createFx(20, () => 0.5);
  fx.burst(5, 0); // 5 particles
  const out = new Float32Array(30 * STRIDE);
  const pl = player({ x: 7, stats: { orbit: 1, weapons: {} } });
  const n = packInstances(w, pl, G({ fx }), out);
  assert.equal(n, 4 + 5 + 1 + 1); // entities, particles, one blade, player
  const T = ENEMY_TYPES.length;
  const pal = (k: number) => out[k * STRIDE + 3];
  assert.deepEqual([0, 1, 2, 3].map(pal), [T + 4, ENEMY.CHASER, T, T + 1]); // gem, enemy, enemy arrow, arrow
  assert.equal(pal(9), T + 6); // blade
  assert.equal(pal(10), T + 2); // player
});

// main.ts falls back to Canvas2D only if construction throws; a null 2D context used to fail on the first frame instead.
test('createWebGLRenderer throws at construction when a 2D context is unavailable', () => {
  const canvas = (ctx: Record<string, unknown>) => ({ width: 0, height: 0, getContext: (k: string) => ctx[k] ?? null }) as unknown as HTMLCanvasElement; // fake: only getContext is read before the throw
  const gl = canvas({ webgl2: {}, '2d': {} });
  const view = { w: 900, h: 600 };
  assert.throws(() => createWebGLRenderer(gl, canvas({ '2d': {} }), canvas({}), view), /2D canvas context unavailable/); // bg missing
  assert.throws(() => createWebGLRenderer(gl, canvas({}), canvas({ '2d': {} }), view), /2D canvas context unavailable/); // hud missing
  assert.throws(() => createWebGLRenderer(canvas({}), canvas({ '2d': {} }), canvas({ '2d': {} }), view), /WebGL2 unavailable/); // order unchanged
});

const TT = ENEMY_TYPES.length;

test('crit and push particles pack the white and grey palette ids', () => {
  const pals = (fx: ReturnType<typeof createFx>) => {
    const out = new Float32Array((POOL + 2) * STRIDE);
    const n = packInstances(new World(2), player(), G({ fx }), out) - 1; // minus the player
    assert.ok(n > 0);
    return new Set(Array.from({ length: n }, (_, k) => out[k * STRIDE + 3]));
  };
  const a = createFx(POOL);
  a.crit(10, 10);
  assert.deepEqual(pals(a), new Set([TT + 5])); // P_FLASH
  const b = createFx(POOL);
  b.push(10, 10, 1, 0);
  assert.deepEqual(pals(b), new Set([TT + 6])); // P_BLADE
});

test('packInstances draws an active shockwave as three rings, none when idle', () => {
  const w = new World(2);
  const ws = createWeaponState();
  const out = new Float32Array((2 + WEAPON_INSTANCES) * STRIDE);
  assert.equal(packInstances(w, player(), G({ wstate: ws }), out), 1); // just the player
  ws.shock.on = true;
  ws.shock.x = 100;
  ws.shock.y = 120;
  ws.shock.r = 50;
  ws.shock.max = 150;
  assert.equal(packInstances(w, player(), G({ wstate: ws }), out), 4);
  assert.deepEqual(Array.from(out.subarray(0, 4)), [100, 120, 50, TT + 5]); // white ring palette (P_FLASH)
  assert.ok(out[4] < 0 && out[4] >= -1); // ring fade
});

test('packInstances draws a chain-lightning zap as fading dots along its path, and caps them', () => {
  const w = new World(2);
  const ws = createWeaponState();
  ws.chain.life = CHAIN_LIFE / 2;
  ws.chain.n = 2;
  ws.chain.px.set([0, 100]);
  ws.chain.py.set([0, 0]);
  const out = new Float32Array((2 + WEAPON_INSTANCES) * STRIDE);
  const n = packInstances(w, player(), G({ wstate: ws }), out);
  assert.ok(n > 5 && n <= 1 + WEAPON_INSTANCES);
  assert.ok(Math.abs(out[4] - 0.5) < 1e-6); // dot alpha = life / CHAIN_LIFE
  ws.chain.px.set([0, 5000]); // a path far longer than the cap
  assert.ok(packInstances(w, player(), G({ wstate: ws }), out) <= 1 + WEAPON_INSTANCES);
});

test('packInstances draws a flying boomerang as a solid circle and skips an idle one', () => {
  const w = new World(2);
  const ws = createWeaponState();
  const out = new Float32Array((2 + WEAPON_INSTANCES) * STRIDE);
  assert.equal(packInstances(w, player(), G({ wstate: ws }), out), 1);
  ws.boom.b[0].phase = 1;
  ws.boom.b[0].x = 40;
  ws.boom.b[0].y = 50;
  assert.equal(packInstances(w, player(), G({ wstate: ws }), out), 2);
  assert.deepEqual(Array.from(out.subarray(0, 5)), [40, 50, BOOM_RADIUS, TT + 7, 2]); // P_WEAPON, solid
});

test('packInstances draws each live fire patch as a burn-coloured disc at most FIRE_ALPHA opaque that fades with its life, packed before enemies, and skips dead ones', () => {
  const w = new World(4);
  spawnEnemy(w, ENEMY.CHASER, 300, 300); // a plain enemy: it must be packed after every patch
  const ws = createWeaponState();
  const L = FLAME_LEVELS[2];
  const f = ws.fire;
  f.x[0] = 100; f.y[0] = 100; f.life[0] = L.life; // full life
  f.x[1] = 150; f.y[1] = 100; f.life[1] = L.life / 2; // half
  f.x[2] = 200; f.y[2] = 100; f.life[2] = 0; // dead
  const out = new Float32Array((4 + WEAPON_INSTANCES) * STRIDE);
  const pl = player({ stats: { orbit: 0, weapons: { flame: 3 } } });
  const n = packInstances(w, pl, G({ wstate: ws }), out);
  const burn = COLORS.lastIndexOf(IGNITE_TINT); // P_BURN
  const discs: number[][] = [];
  let enemyAt = -1;
  for (let i = 0; i < n; i++) {
    if (out[i * STRIDE + 3] === burn) discs.push([out[i * STRIDE + 2], out[i * STRIDE + 4], i]);
    else if (out[i * STRIDE] === 300) enemyAt = i;
  }
  assert.equal(discs.length, 2);
  assert.equal(discs[0][0], L.radius);
  assert.ok(Math.abs(discs[0][1] - FIRE_ALPHA) < 1e-6);
  assert.ok(Math.abs(discs[1][1] - FIRE_ALPHA / 2) < 1e-6);
  assert.ok(enemyAt >= 0 && discs.every((d) => d[2] < enemyAt), 'fire patches pack (draw) before enemies');
});
