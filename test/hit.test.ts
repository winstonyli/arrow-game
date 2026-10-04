import test from 'node:test';
import assert from 'node:assert/strict';
import { KIND } from '../src/core/world.ts';
import { collisionSystem } from '../src/core/systems.ts';
import { spawnEnemy, ENEMY } from '../src/game/enemies.ts';
import { createGame, tick } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { orbitSystem, bladePos } from '../src/game/orbit.ts';
import { hitEnemy, explosionSystem, HIT_CRIT, HIT_KNOCK } from '../src/game/hit.ts';
import { BLAST_CAP } from '../src/game/modifiers.ts';
import { applySkill, pickChoices, offerTag, SKILLS } from '../src/game/skills.ts';
import { baseStats } from '../src/game/player.ts';
import { seeded } from '../src/core/math.ts';
import type { Game } from '../src/game/game.ts';

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
  const hp = g.world.hp[near];
  hitEnemy(g, victim, 1e6, 0, 0, 0);
  assert.equal(g.blasts.n, 1);
  settle(g);
  assert.equal(explosionSystem(g), 0);
  assert.equal(g.world.hp[near], hp - 20);
  assert.equal(g.world.hp[far], hp);
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

test('a crowd killed by shockwave with explosions: every kill once, the kill count matches onKill', () => {
  const g = arenaGame();
  applySkill(g.player.stats, 'shockwave');
  g.player.stats.weapons.shockwave = 5;
  g.player.stats.explode = 5;
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
});

test('the explosive modifier is a levelled arena skill', () => {
  const s = baseStats();
  applySkill(s, 'explode');
  assert.equal(s.explode, 1);
  assert.ok(!pickChoices(seeded(3), 50, null, false).includes('explode'));
});
