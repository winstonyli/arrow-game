// Headless arena soak: a stationary invulnerable player (autofire kills what approaches) for N minutes
// of game time, picking the first offered skill at each level-up. Prints one line per minute so
// entity growth, the high-water mark, dropped spawns and per-tick cost under churn are visible.
// Real play differs (the player moves and only fires while stationary), so treat it as a load proxy.
// Usage: node scripts/soak-arena.js [--minutes=10]
import { createGame, tick, choose } from '../src/game/game.js';
import { createArena, ARENA_BOUNDS } from '../src/modes/arena.js';
import { seeded } from '../src/core/math.js';
import { KIND } from '../src/core/world.js';

const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const minutes = Number(arg('minutes', 10));
const DT = 1 / 60;
const TICKS_PER_MIN = 3600;

const g = createGame({ capacity: 50000, bounds: ARENA_BOUNDS, mode: createArena(), rng: seeded(1), input: { x: 0, y: 0 } });
g.player.hp = g.player.maxHp = 1e9;

console.log('min  enemies   gems   high  dropped  level  kills   tick ms (median / p95)');
for (let m = 1; m <= minutes; m++) {
  const ms = new Float64Array(TICKS_PER_MIN);
  for (let k = 0; k < TICKS_PER_MIN; k++) {
    if (g.offer) choose(g, g.offer[0]);
    const t0 = performance.now();
    tick(g, DT);
    ms[k] = performance.now() - t0;
  }
  ms.sort();
  const w = g.world;
  console.log(
    [m, w.kindCount[KIND.ENEMY], w.kindCount[KIND.GEM], w.high, w.dropped, g.level, g.kills]
      .map((v, i) => String(v).padStart([3, 9, 7, 7, 8, 6, 7][i]))
      .join('') + `   ${ms[TICKS_PER_MIN >> 1].toFixed(2)} / ${ms[Math.floor(TICKS_PER_MIN * 0.95)].toFixed(2)}`,
  );
}
