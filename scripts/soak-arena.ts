// Headless arena soak: a stationary invulnerable player (autofire kills what approaches) for N minutes
// of game time, picking the first offered skill at each level-up. Prints one line per minute so
// entity growth, the high-water mark, dropped spawns and per-tick cost under churn are visible.
// Real play differs (the player moves and only fires while stationary), so treat it as a load proxy.
// --bot=kite makes the player mortal and steers it: flee nearby enemies, avoid walls, else drift to the nearest gem.
// --bot=smart is the same plus: skill priority (damage/rate/multishot before speed), gems pulled in even with enemies near, and a sideways component so it circles instead of pinning itself on a wall.
// It reports when the bot dies, which is the survival-time yardstick for balance changes.
// At the end it prints the run's damage, healing and activity breakdown (damage share per weapon and upgrade; the upgrade rows are approximate), the balance data: run several --seed values to compare.
// Usage: node scripts/soak-arena.ts [--minutes=10] [--bot=still|kite|smart] [--seed=1] [--picks=random|id,id,...] [--grant=id,id,...]
import { createGame, tick, choose } from '../src/game/game.ts';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.ts';
import { seeded } from '../src/core/math.ts';
import { applySkill } from '../src/game/skills.ts';
import { KIND } from '../src/core/world.ts';
import type { Game } from '../src/game/game.ts';
import { formatRunStats } from '../src/game/runstats-report.ts';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const minutes = Number(arg('minutes', 10));
const bot = arg('bot', 'still');
const DT = 1 / 60;
const TICKS_PER_MIN = 3600;

const g = createGame({ capacity: 50000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(Number(arg('seed', 1))), input: { x: 0, y: 0 } });
if (bot === 'still') g.player.hp = g.player.maxHp = 1e9;
// --grant=a,b,c applies those skills before the first tick (counted in g.skills): the balance sweep uses it to start a run with a weapon or branch, since a random offer rarely reaches a level-2 fork before the bot dies.
for (const id of arg('grant', '').split(',').filter(Boolean)) { applySkill(g.player.stats, id); g.skills[id] = (g.skills[id] ?? 0) + 1; }

// Smart bot skill priority, first wins: weapons, then the six modifiers, then the other upgrades. Unlisted ids sort first (indexOf -1), so list every id.
const PRIORITY = ['multishot', 'rapid', 'power', 'shockwave', 'shockwave.a', 'shockwave.b', 'chain', 'chain.a', 'chain.b', 'blade', 'blade.a', 'blade.b', 'boomerang', 'flame', 'mines', 'meteor', 'beam', 'drone', 'drone.a', 'drone.b', 'daggers', 'crit', 'explode', 'vamp', 'frost', 'ignite', 'knockback', 'homing', 'pierce', 'regen', 'ricochet', 'magnet', 'swift'];
// --picks=random takes a random offered card (own seeded RNG, so the sim is untouched); --picks=a,b,c ranks the listed ids first (the rest keep the smart order). Default: smart bot uses PRIORITY, the others take the first card.
const picks = arg('picks', '');
const pickRng = seeded(Number(arg('seed', 1)) + 1000003);
const rank = picks && picks !== 'random' ? [...picks.split(','), ...PRIORITY] : PRIORITY;
const pick = (offer: string[]): string => {
  if (picks === 'random') return offer[Math.floor(pickRng() * offer.length)];
  return bot === 'smart' || picks ? [...offer].sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] : offer[0];
};

// Flee enemies within FLEE px (1/d weighting), push off walls, and with nothing near, chase the nearest gem.
function steer(g: Game): void {
  const { world, player, bounds } = g;
  const FLEE = 260;
  let fx = 0, fy = 0, gx = 0, gy = 0, gd = Infinity;
  for (let i = 0; i < world.high; i++) {
    const k = world.kind[i];
    if (k === KIND.NONE) continue;
    const dx = player.x - world.x[i], dy = player.y - world.y[i];
    const d = Math.hypot(dx, dy) || 1;
    if (k === KIND.GEM) { if (d < gd) { gd = d; gx = -dx / d; gy = -dy / d; } continue; }
    if (k === KIND.PROJECTILE || d > FLEE) continue;
    const w = (FLEE - d) / FLEE / d;
    fx += dx * w; fy += dy * w;
  }
  const M = 250;
  fx += Math.max(0, M - player.x) / M - Math.max(0, M - (bounds.w - player.x)) / M;
  fy += Math.max(0, M - player.y) / M - Math.max(0, M - (bounds.h - player.y)) / M;
  const smart = bot === 'smart';
  let m = Math.hypot(fx, fy);
  if (smart && m > 0.02) {
    const near = gd < 400 ? 0.7 : 0; // keep collecting while fleeing
    const sx = -fy / m * 0.5, sy = fx / m * 0.5; // sidestep: circle rather than back into a wall
    fx = fx / m + sx + gx * near;
    fy = fy / m + sy + gy * near;
    m = Math.hypot(fx, fy);
  }
  if (m > 0.02) { g.input.x = fx / m; g.input.y = fy / m; } else if (gd < Infinity) { g.input.x = gx; g.input.y = gy; } else { g.input.x = 0; g.input.y = 0; }
}

console.log('min  enemies   gems   high  dropped  level  kills   tick ms (median / p95)');
for (let m = 1; m <= minutes; m++) {
  const ms = new Float64Array(TICKS_PER_MIN);
  for (let k = 0; k < TICKS_PER_MIN; k++) {
    if (g.offer) choose(g, pick(g.offer));
    if (bot !== 'still') steer(g);
    const t0 = performance.now();
    tick(g, DT);
    ms[k] = performance.now() - t0;
  }
  ms.sort();
  const w = g.world;
  if (g.over) {
    console.log(`bot died at ${g.time.toFixed(1)} s (minute ${m}): level ${g.level}, ${g.kills} kills`);
    break;
  }
  console.log(
    [m, w.kindCount[KIND.ENEMY], w.kindCount[KIND.GEM], w.high, w.dropped, g.level, g.kills]
      .map((v, i) => String(v).padStart([3, 9, 7, 7, 8, 6, 7][i]))
      .join('') + `   ${ms[TICKS_PER_MIN >> 1].toFixed(2)} / ${ms[Math.floor(TICKS_PER_MIN * 0.95)].toFixed(2)}`,
  );
}
console.log('');
for (const line of formatRunStats(g.stats)) console.log(line);
// --json adds one machine-readable last line (scripts/balance-sweep.ts reads it): seconds survived, whether the bot died, picks, damage by source (SOURCE_IDS order), upgrade shares, healing and activity.
if (arg('json', '') !== '') console.log('JSON ' + JSON.stringify({ secs: g.time, died: g.over, skills: g.skills, dmg: [...g.stats.dmg], up: [...g.stats.up], heal: [...g.stats.heal], act: [...g.stats.act] }));
