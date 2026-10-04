import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND } from '../src/core/world.ts';
import { collisionSystem } from '../src/core/systems.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { COLORS } from '../src/render/webgl.ts';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { updateShockwave } from '../src/game/weapons/shockwave.ts';
import { updateChain } from '../src/game/weapons/chain.ts';
import { orbitSystem, bladePos } from '../src/game/orbit.ts';
import { hitEnemy, explosionSystem, statusSystem, HIT_CRIT, HIT_KNOCK, HIT_STATUS, HIT_TICK } from '../src/game/hit.ts';
import { BLAST_CAP, FROST_TINT, IGNITE_TINT, FROST_SECS, IGNITE_SECS, IGNITE_DPS } from '../src/game/modifiers.ts';
import { applySkill, pickChoices, offerTag, SKILLS } from '../src/game/skills.ts';
import { baseStats } from '../src/game/player.ts';
import { seeded } from '../src/core/math.ts';
import { stateHash } from '../src/replay/hash.ts';
import type { Game, GameFx } from '../src/game/game.ts';

const arenaGame = () => createGame({ capacity: 5000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
const settle = (g: Game) => g.grid.rebuild(g.world, KIND.ENEMY);
const at = (g: Game, dx: number, dy = 0) => spawnEnemy(g.world, ENEMY.BRUISER, g.player.x + dx, g.player.y + dy);

test('hitEnemy counts a kill once, calls onKill before the despawn, and rejects a stale slot', () => {
  const g = arenaGame();
  const seen: number[] = [];
  g.onKill = (j) => seen.push(g.world.kind[j]);
  const j = at(g, 100);
  assert.equal(hitEnemy(g, j, 1, 0, 0, 0), 0);
  assert.equal(hitEnemy(g, j, 1e6, 0, 0, 0), 1);
  assert.deepEqual(seen, [KIND.ENEMY]);
  const free = g.world.freeCount;
  g.world.hp[j] = 0; // as a slot killed earlier in the tick: stale, hp <= 0
  assert.equal(hitEnemy(g, j, 1e6, 0, 0, 0), 0);
  assert.equal(seen.length, 1);
  assert.equal(g.world.freeCount, free);
  const live = at(g, 200); // a LIVE enemy slot with hp already <= 0 (kind still ENEMY): also rejected
  g.world.hp[live] = 0;
  assert.equal(g.world.kind[live], KIND.ENEMY);
  assert.equal(hitEnemy(g, live, 1e6, 0, 0, 0), 0);
  assert.equal(seen.length, 1);
  assert.equal(g.world.kind[live], KIND.ENEMY);
});

test('collisionSystem sends an arrow hit through the hit callback with the arrow velocity', () => {
  const g = arenaGame();
  const e = at(g, 100);
  const a = g.world.spawn(KIND.PROJECTILE, g.player.x + 100, g.player.y, 300, 20, 4, 0);
  g.world.damage[a] = 7;
  g.world.life[a] = 5;
  settle(g);
  const calls: number[][] = [];
  const kills = collisionSystem(g.world, g.grid, g.player, null, (j, dmg, dx, dy) => { calls.push([j, dmg, dx, dy]); return 1; });
  assert.deepEqual(calls, [[e, 7, 300, 20]]);
  assert.equal(kills, 1);
});

test('orbitSystem sends a blade tick through the hit callback with the rate damage', () => {
  const g = arenaGame();
  g.player.stats.orbit = 1;
  g.player.stats.bladeDps = 30;
  g.player.stats.damageMult = 2;
  const pos = { x: 0, y: 0 };
  bladePos(g.player, 0, 0, pos);
  const e = spawnEnemy(g.world, ENEMY.BRUISER, pos.x, pos.y);
  settle(g);
  const calls: number[][] = [];
  orbitSystem(g.world, g.grid, g.player, 0, 0.1, null, (j, dmg) => { calls.push([j, dmg]); return 0; });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], e);
  assert.ok(Math.abs(calls[0][1] - 6) < 1e-9); // 30 * 2 * 0.1
});

const withRng = (g: Game, values: number[]) => {
  let i = 0;
  g.rng = () => values[Math.min(i++, values.length - 1)];
  return () => i; // draws so far
};

test('crit never draws without the modifier, nor for a hit that cannot crit', () => {
  const g = arenaGame();
  const draws = withRng(g, [0]);
  const j = at(g, 100);
  hitEnemy(g, j, 10, HIT_CRIT, 0, 0); // level 0
  g.player.stats.crit = 5;
  hitEnemy(g, j, 10, 0, 0, 0); // flag missing
  assert.equal(draws(), 0);
});

test('crit doubles a flagged hit when the roll lands under the chance and not above it', () => {
  const g = arenaGame();
  g.player.stats.crit = 5; // 50%
  withRng(g, [0.49, 0.5]);
  const a = at(g, 100);
  const b = at(g, 200);
  const hp = g.world.hp[a];
  hitEnemy(g, a, 10, HIT_CRIT, 0, 0);
  hitEnemy(g, b, 10, HIT_CRIT, 0, 0);
  assert.equal(g.world.hp[a], hp - 20);
  assert.equal(g.world.hp[b], hp - 10);
});

test('the crit modifier is an arena skill that levels to 5 and shows its level step', () => {
  const s = baseStats();
  assert.equal(offerTag(s, 'crit'), 'NEW');
  applySkill(s, 'crit');
  assert.equal(s.crit, 1);
  assert.equal(offerTag(s, 'crit'), 'Lv 1 → 2');
  for (let k = 0; k < 9; k++) applySkill(s, 'crit');
  assert.equal(s.crit, 5);
  const crit = SKILLS.find((k) => k.id === 'crit');
  assert.equal(crit?.available?.(s), false);
  const rooms = pickChoices(seeded(3), 50, null, false);
  assert.ok(!rooms.includes('crit'));
  assert.ok(pickChoices(seeded(3), 50, null, true).includes('crit'));
});

test('knockback pushes a surviving enemy along the hit direction, per level', () => {
  const g = arenaGame();
  g.player.stats.knockback = 2;
  const j = at(g, 100);
  const x = g.world.x[j];
  const y = g.world.y[j];
  hitEnemy(g, j, 1, HIT_KNOCK, 3, 4); // direction (0.6, 0.8), 2 levels x 10 px
  assert.ok(Math.abs(g.world.x[j] - (x + 12)) < 1e-3);
  assert.ok(Math.abs(g.world.y[j] - (y + 16)) < 1e-3);
});

test('knockback skips unflagged hits, zero-direction hits, a level-0 player and kills', () => {
  const g = arenaGame();
  const j = at(g, 100);
  const x = g.world.x[j];
  hitEnemy(g, j, 1, HIT_KNOCK, 1, 0); // level 0
  g.player.stats.knockback = 3;
  hitEnemy(g, j, 1, 0, 1, 0); // flag missing
  hitEnemy(g, j, 1, HIT_KNOCK, 0, 0); // no direction
  assert.equal(g.world.x[j], x);
  const killed = at(g, 200);
  const kx = g.world.x[killed];
  hitEnemy(g, killed, 1e6, HIT_KNOCK, 1, 0);
  assert.equal(g.world.kind[killed], 0);
  assert.equal(g.world.x[killed], kx);
});

test('knockback stops at the arena wall', () => {
  const g = arenaGame();
  g.player.stats.knockback = 5; // 50 px
  const j = spawnEnemy(g.world, ENEMY.BRUISER, ARENA_BOUNDS.w - 30, 500);
  hitEnemy(g, j, 1, HIT_KNOCK, 1, 0);
  assert.equal(g.world.x[j], ARENA_BOUNDS.w - g.world.radius[j]);
});

test('the knockback modifier is a levelled arena skill', () => {
  const s = baseStats();
  applySkill(s, 'knockback');
  assert.equal(s.knockback, 1);
  assert.ok(!pickChoices(seeded(3), 50, null, false).includes('knockback'));
});

test('vampiric heals per kill and per level, capped at max HP, and not for a hit that does not kill', () => {
  const g = arenaGame();
  g.player.stats.vamp = 3;
  g.player.hp = 50;
  hitEnemy(g, at(g, 100), 1, 0, 0, 0); // survives
  assert.equal(g.player.hp, 50);
  hitEnemy(g, at(g, 150), 1e6, 0, 0, 0);
  assert.equal(g.player.hp, 53);
  g.player.hp = g.player.maxHp - 1;
  hitEnemy(g, at(g, 200), 1e6, 0, 0, 0);
  assert.equal(g.player.hp, g.player.maxHp);
});

test('vampiric does nothing at level 0', () => {
  const g = arenaGame();
  g.player.hp = 50;
  hitEnemy(g, at(g, 100), 1e6, 0, 0, 0);
  assert.equal(g.player.hp, 50);
});

test('the vampiric modifier is a levelled arena skill', () => {
  const s = baseStats();
  applySkill(s, 'vamp');
  assert.equal(s.vamp, 1);
  assert.ok(!pickChoices(seeded(3), 50, null, false).includes('vamp'));
});

test('an explosive kill damages neighbours inside the radius once the tick drains the queue', () => {
  const g = arenaGame();
  g.player.stats.explode = 2; // radius 60, damage 20
  const victim = at(g, 100);
  const near = at(g, 140); // 40 px away: inside
  const far = at(g, 400);
  const r = g.world.radius[near];
  const edge = at(g, 100 + 60 + r / 2); // centre beyond the radius but its edge overlaps it: hit
  const clear = at(g, 100 + 60 + r + 5); // beyond radius + its own radius: spared
  const hp = g.world.hp[near];
  hitEnemy(g, victim, 1e6, 0, 0, 0);
  assert.equal(g.blasts.n, 1);
  settle(g);
  assert.equal(explosionSystem(g), 0);
  assert.equal(g.world.hp[near], hp - 20);
  assert.equal(g.world.hp[far], hp);
  assert.equal(g.world.hp[edge], hp - 20);
  assert.equal(g.world.hp[clear], hp);
  assert.equal(g.blasts.n, 0);
});

test('a kill caused by an explosion queues no explosion of its own, and counts as a kill', () => {
  const g = arenaGame();
  g.player.stats.explode = 5;
  const victim = at(g, 100);
  const doomed = at(g, 130);
  g.world.hp[doomed] = 1;
  hitEnemy(g, victim, 1e6, 0, 0, 0);
  settle(g);
  assert.equal(explosionSystem(g), 1);
  assert.equal(g.world.kind[doomed], 0);
  assert.equal(g.blasts.n, 0);
});

test('the blast queue is bounded and drops the overflow', () => {
  const g = arenaGame();
  g.player.stats.explode = 1;
  for (let k = 0; k < BLAST_CAP + 6; k++) hitEnemy(g, at(g, 80 + k), 1e6, 0, 0, 0);
  assert.equal(g.blasts.n, BLAST_CAP);
});

test('no explosion without the modifier', () => {
  const g = arenaGame();
  hitEnemy(g, at(g, 100), 1e6, 0, 0, 0);
  assert.equal(g.blasts.n, 0);
});

test('each blast shows one ring at least as wide as its damage radius', () => {
  const g = arenaGame();
  const rings: number[][] = [];
  g.fx = { kill: (x, y, r, pal) => rings.push([x, y, r, pal]), burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: () => {} };
  g.player.stats.explode = 3; // radius 70
  hitEnemy(g, at(g, 100), 1e6, 0, 0, 0);
  hitEnemy(g, at(g, 300), 1e6, 0, 0, 0);
  settle(g);
  explosionSystem(g);
  assert.equal(rings.length, 2);
  for (const [, , r] of rings) assert.ok(r >= 70);
});

test('the Shockwave ring never knocks back, even with Knockback maxed', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  g.player.stats.knockback = 5;
  const j = at(g, 100);
  g.world.hp[j] = 1000; // survives the pulse
  const x = g.world.x[j];
  const y = g.world.y[j];
  const hp = g.world.hp[j];
  for (let k = 0; k < 40; k++) {
    settle(g);
    updateShockwave(g, 1, 1 / 60);
  }
  assert.ok(g.world.hp[j] < hp, 'the ring did hit it');
  assert.equal(g.world.x[j], x);
  assert.equal(g.world.y[j], y);
});

// 40 low-hp chasers in a spiral around the player, shockwave level 5, then 3 s of ticks. Returns the final kill
// count; every kill must reach onKill exactly once.
function crowdRun(explode: number): number {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  g.player.stats.weapons.shockwave = 5;
  g.player.stats.explode = explode;
  g.player.hp = g.player.maxHp = 1e9;
  const killed = new Set<string>();
  let calls = 0;
  g.onKill = (j) => {
    calls++;
    const key = `${j}:${g.world.gen[j]}`;
    assert.ok(!killed.has(key), `slot killed twice: ${key}`);
    killed.add(key);
  };
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    const j = spawnEnemy(g.world, ENEMY.CHASER, g.player.x + Math.cos(a) * (60 + k * 5), g.player.y + Math.sin(a) * (60 + k * 5));
    g.world.hp[j] = 5;
  }
  for (let k = 0; k < 180; k++) tick(g, 1 / 60);
  assert.ok(calls > 0);
  assert.equal(g.kills, calls);
  assert.equal(g.blasts.n, 0);
  return calls;
}

test('a crowd killed by shockwave with explosions: every kill once, and explosions add kills', () => {
  assert.ok(crowdRun(5) > crowdRun(0), 'an explosion fired and killed something the shockwave alone did not');
});

test('the explosive modifier is a levelled arena skill', () => {
  const s = baseStats();
  applySkill(s, 'explode');
  assert.equal(s.explode, 1);
  assert.ok(!pickChoices(seeded(3), 50, null, false).includes('explode'));
});

// A recording fx: which cue calls a hit made, in order.
function cueFx(g: Game): string[][] {
  const calls: string[][] = [];
  const rec = (name: string) => (...a: number[]) => void calls.push([name, ...a.map(String)]);
  const fx: GameFx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: rec('crit'), push: rec('push'), soft: () => {} };
  g.fx = fx;
  return calls;
}

test('a landed crit calls fx.crit once at the enemy; a missed roll, an unflagged hit and level 0 call nothing', () => {
  const g = arenaGame();
  const calls = cueFx(g);
  const j = at(g, 100);
  const pos = [String(g.world.x[j]), String(g.world.y[j])];
  hitEnemy(g, j, 1, HIT_CRIT, 0, 0); // level 0
  g.player.stats.crit = 5;
  g.rng = () => 0.99; // roll misses
  hitEnemy(g, j, 1, HIT_CRIT, 0, 0);
  g.rng = () => 0; // would land, but the flag is missing
  hitEnemy(g, j, 1, 0, 0, 0);
  assert.deepEqual(calls, []);
  hitEnemy(g, j, 1, HIT_CRIT, 0, 0);
  assert.deepEqual(calls, [['crit', ...pos]]);
});

test('a knockback that moves a survivor calls fx.push once with the old position and the push vector', () => {
  const g = arenaGame();
  const calls = cueFx(g);
  g.player.stats.knockback = 2;
  const j = at(g, 100);
  const x = g.world.x[j];
  const y = g.world.y[j];
  hitEnemy(g, j, 1, HIT_KNOCK, 3, 4);
  assert.equal(calls.length, 1);
  const [name, ox, oy, dx, dy] = calls[0];
  assert.equal(name, 'push');
  assert.equal(Number(ox), x);
  assert.equal(Number(oy), y);
  assert.ok(Math.abs(Number(dx) - 12) < 1e-3 && Math.abs(Number(dy) - 16) < 1e-3);
});

test('knockback cues nothing for a kill, an unflagged hit, a zero direction, level 0, or a wall-pinned enemy', () => {
  const g = arenaGame();
  const calls = cueFx(g);
  const j = at(g, 100);
  hitEnemy(g, j, 1, HIT_KNOCK, 1, 0); // level 0
  g.player.stats.knockback = 3;
  hitEnemy(g, j, 1, 0, 1, 0);
  hitEnemy(g, j, 1, HIT_KNOCK, 0, 0);
  const killed = at(g, 200);
  hitEnemy(g, killed, 1e6, HIT_KNOCK, 1, 0);
  const w = at(g, 300);
  g.world.x[w] = g.bounds.w - g.world.radius[w]; // against the right wall
  hitEnemy(g, w, 1, HIT_KNOCK, 1, 0);
  assert.deepEqual(calls, []);
});

test('stateHash changes when a status timer is set on a live enemy and is restored when it clears', () => {
  const g = arenaGame();
  const j = at(g, 100);
  const base = stateHash(g);
  g.world.slowT[j] = 1.5;
  const slowed = stateHash(g);
  assert.notEqual(slowed, base);
  g.world.slowT[j] = 0;
  g.world.burnT[j] = 2;
  const burning = stateHash(g);
  assert.notEqual(burning, base);
  assert.notEqual(burning, slowed);
  g.world.burnT[j] = 0;
  assert.equal(stateHash(g), base);
});

test('a surviving HIT_STATUS hit sets the timers by level, refreshes rather than stacks, and a kill sets nothing', () => {
  const g = arenaGame();
  const s = g.player.stats;
  const j = at(g, 100);
  hitEnemy(g, j, 1, HIT_STATUS, 0, 0); // levels are 0: nothing set
  assert.equal(g.world.slowT[j], 0);
  assert.equal(g.world.burnT[j], 0);
  s.frost = 1;
  hitEnemy(g, j, 1, HIT_STATUS, 0, 0); // only frost owned
  assert.equal(g.world.slowT[j], FROST_SECS);
  assert.equal(g.world.burnT[j], 0);
  s.ignite = 1;
  g.world.slowT[j] = 0.5; // partly run down: a re-hit refreshes to the full duration, it does not add
  hitEnemy(g, j, 1, HIT_STATUS, 0, 0);
  assert.equal(g.world.slowT[j], FROST_SECS);
  assert.equal(g.world.burnT[j], IGNITE_SECS);
  const k = at(g, 300);
  assert.equal(hitEnemy(g, k, 1e6, HIT_STATUS, 0, 0), 1); // lethal: the slot is despawned, no timer is left behind
  assert.equal(g.world.slowT[k], 0);
  assert.equal(g.world.burnT[k], 0);
});

test('hits without HIT_STATUS (blades, boomerang, burn, blasts) never apply a status', () => {
  const g = arenaGame();
  g.player.stats.frost = 5;
  g.player.stats.ignite = 5;
  const j = at(g, 100);
  hitEnemy(g, j, 1, 0, 0, 0);
  hitEnemy(g, j, 1, HIT_CRIT | HIT_KNOCK, 1, 0); // crit/knock alone carry no status either
  assert.equal(g.world.slowT[j], 0);
  assert.equal(g.world.burnT[j], 0);
});

test('arrows, the Shockwave ring and Chain zaps carry HIT_STATUS', () => {
  const g = arenaGame();
  g.player.stats.frost = 1;
  const a = at(g, 100);
  g.hits.arrow(a, 1, 1, 0); // the persistent arrow callback
  assert.equal(g.world.slowT[a], FROST_SECS);
  const b = at(g, 120, 40);
  applySkill(g.player.stats, 'shockwave');
  settle(g);
  g.wstate.shock.cd = 0;
  tick(g, 1 / 60);
  for (let t = 0; t < 120 && g.world.slowT[b] === 0; t++) tick(g, 1 / 60); // the ring reaches it
  assert.ok(g.world.slowT[b] > 0, 'shockwave applies frost');
  const g2 = arenaGame();
  g2.player.stats.frost = 1;
  applySkill(g2.player.stats, 'chain');
  const c = at(g2, 80);
  settle(g2);
  g2.wstate.chain.cd = 0;
  updateChain(g2, 1, 1 / 60); // called directly: tick's own arrows could also hit it and mask the zap
  assert.ok(g2.world.slowT[c] > 0, 'chain applies frost');
});

test('tick slows a Frost-hit chaser: it covers less ground than an unhit twin (Frost 5 vs 0 over the same ticks)', () => {
  const run = (frost: number) => {
    const g = arenaGame();
    g.player.stats.frost = frost;
    const a = spawnEnemy(g.world, ENEMY.CHASER, 100, 100);
    g.player.x = 800;
    g.player.y = 100;
    g.world.slowT[a] = 5; // as if hit; the arrow path is covered above
    for (let t = 0; t < 30; t++) tick(g, 1 / 60);
    return g.world.x[a] - 100;
  };
  const free = run(0);
  const slowed = run(5);
  assert.ok(slowed > 0 && slowed < free * 0.5, `slowed ${slowed} vs free ${free}`);
});

test('statusSystem decrements both timers, floors at 0, and burn damage scales with dt and level', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.ignite = 2;
  const j = at(g, 100);
  const hp0 = g.world.hp[j];
  g.world.slowT[j] = 0.05;
  g.world.burnT[j] = 1;
  statusSystem(g, 0.1);
  assert.ok(Math.abs(g.world.burnT[j] - 0.9) < 1e-6);
  assert.equal(g.world.slowT[j], 0);
  assert.ok(Math.abs(hp0 - g.world.hp[j] - IGNITE_DPS * 2 * s.damageMult * 0.1) < 1e-4);
  const k = at(g, 200);
  g.world.burnT[k] = 1;
  statusSystem(g, 0.2); // twice the dt: twice the damage on a twin burning the same way
  assert.ok(Math.abs(g.world.hp[k] - (hp0 - IGNITE_DPS * 2 * s.damageMult * 0.2)) < 1e-4);
  assert.ok(Math.abs(g.world.hp[j] - (hp0 - IGNITE_DPS * 2 * s.damageMult * 0.3)) < 1e-4); // j burned again in the second call
});

test('statusSystem does nothing without a status level, and an expired timer stops burning', () => {
  const g = arenaGame();
  const j = at(g, 100);
  g.world.burnT[j] = 1; // no levels: the system returns before touching the world
  const hp0 = g.world.hp[j];
  assert.equal(statusSystem(g, 0.5), 0);
  assert.equal(g.world.burnT[j], 1);
  assert.equal(g.world.hp[j], hp0);
  g.player.stats.ignite = 1;
  g.world.burnT[j] = 0; // expired: no damage
  statusSystem(g, 0.5);
  assert.equal(g.world.hp[j], hp0);
});

test('burn kills count once, heal (Vampiric), queue a blast (Explosive) and never apply a status', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.ignite = 5;
  s.vamp = 2;
  s.explode = 1;
  s.frost = 1;
  g.player.hp = g.player.maxHp - 10;
  const hp = g.player.hp;
  const j = at(g, 100);
  g.world.hp[j] = 0.001;
  g.world.burnT[j] = 1;
  const seen: number[] = [];
  g.onKill = (x) => seen.push(x);
  assert.equal(statusSystem(g, 1 / 60), 1);
  assert.deepEqual(seen, [j]);
  assert.equal(g.player.hp, hp + 2);
  assert.equal(g.blasts.n, 1);
  const other = at(g, 150);
  g.world.burnT[other] = 1;
  statusSystem(g, 1 / 60);
  assert.equal(g.world.slowT[other], 0, 'a burn tick never starts Frost');
});

test('over a crowd burn kills equal onKill calls and no slot is killed twice (Splitter spawns recycle slots mid-loop)', () => {
  const g = arenaGame();
  g.player.stats.ignite = 5;
  const killed: number[] = [];
  const modeKill = g.onKill; // the arena's own onKill spawns Swarmers from a dead Splitter
  g.onKill = (j) => {
    killed.push(g.world.gen[j] * 100000 + j);
    modeKill?.(j);
  };
  for (let n = 0; n < 60; n++) {
    const j = spawnEnemy(g.world, n % 3 === 0 ? ENEMY.SPLITTER : ENEMY.CHASER, g.player.x + 50 + n * 4, g.player.y + (n % 7) * 20);
    g.world.hp[j] = 0.01;
    g.world.burnT[j] = 1;
  }
  const kills = statusSystem(g, 1 / 60);
  assert.equal(kills, killed.length);
  assert.equal(new Set(killed).size, killed.length);
  assert.ok(kills >= 60, 'every seeded enemy burned to death');
});

test('a burn kill through tick() drains its blast the same tick and the blast hits a neighbour', () => {
  const g = arenaGame();
  const s = g.player.stats;
  s.ignite = 1;
  s.explode = 5;
  const a = at(g, 300);
  const b = at(g, 320);
  g.world.hp[a] = 0.001;
  g.world.burnT[a] = 1;
  const hpB = g.world.hp[b];
  tick(g, 1 / 60);
  assert.equal(g.world.kind[a], KIND.NONE, 'the burning enemy died');
  assert.equal(g.blasts.n, 0, 'the queue is empty at the end of the tick');
  assert.ok(g.world.hp[b] < hpB - 1, 'the blast damaged the neighbour this tick');
});

test('a 3 s burn deals damage on exactly IGNITE_SECS * 60 ticks (float32 residue is treated as expired)', () => {
  const g = arenaGame();
  g.player.stats.ignite = 1;
  const j = at(g, 100);
  g.world.burnT[j] = Math.fround(IGNITE_SECS);
  let n = 0;
  for (let t = 0; t < 400 && g.world.burnT[j] > 0; t++) {
    const hp = g.world.hp[j];
    statusSystem(g, 1 / 60);
    if (g.world.hp[j] < hp) n++;
  }
  assert.equal(g.world.burnT[j], 0);
  assert.equal(n, IGNITE_SECS * 60);
});

test('the status tints are not any other enemy, gem, shot, flash or canvas colour (CIE Lab distance > 30)', () => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lab = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(lin);
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const dist = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
  const others = [...new Set([...COLORS, '#161b22', '#30363d'])].filter((c) => c !== FROST_TINT && c !== IGNITE_TINT);
  assert.ok(others.length > 12);
  for (const tint of [FROST_TINT, IGNITE_TINT]) for (const c of others) assert.ok(dist(tint, c) > 30, `${tint} vs ${c}`);
  assert.ok(dist(FROST_TINT, IGNITE_TINT) > 30);
});

test('a HIT_TICK hit that survives tells fx.soft; other hits and kills do not', () => {
  const g = arenaGame();
  const soft: Array<[number, number]> = [];
  g.fx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: (j, d) => soft.push([j, d]) };
  const j = at(g, 100);
  hitEnemy(g, j, 3, 0, 0, 0);
  assert.equal(soft.length, 0);
  hitEnemy(g, j, 3, HIT_TICK, 0, 0);
  assert.deepEqual(soft, [[j, 3]]);
  hitEnemy(g, j, 1e6, HIT_TICK, 0, 0); // lethal: the slot is despawned, nothing to soften
  assert.equal(soft.length, 1);
});

test('burn ticks are soft: statusSystem tells fx.soft for each burn tick', () => {
  const g = arenaGame();
  g.player.stats.ignite = 2;
  const soft: number[] = [];
  g.fx = { kill: () => {}, burst: () => {}, shake: () => {}, sample: () => {}, crit: () => {}, push: () => {}, soft: (j) => soft.push(j) };
  const j = at(g, 100);
  g.world.burnT[j] = 1;
  statusSystem(g, 0.1);
  assert.deepEqual(soft, [j]);
});
