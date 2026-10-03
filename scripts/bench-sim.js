// Headless sim benchmark: ms per tick by system at several entity counts.
// Usage: node scripts/bench-sim.js [--n=1000,5000,10000,20000] [--scenario=dense,sparse,converge] [--ticks=300]
//   dense:    static targets in the 900x600 arena (very crowded)
//   sparse:   static targets, arena scaled so density stays at 1 entity per 2500 px^2
//   converge: chasers pile onto the player in the 900x600 arena (worst case for the grid)
// N is the total entity count: half enemies, half player projectiles.
import { createGame, tick, BOUNDS } from '../src/game/game.js';
import { createStress } from '../src/modes/stress.js';
import { seeded } from '../src/core/math.js';
import { KIND } from '../src/core/world.js';
import { ENEMY, enemyAISystem, MAX_ENEMY_RADIUS } from '../src/game/enemies.js';
import { movePlayer, autoFire } from '../src/game/player.js';
import { moveSystem, projectileSystem, collisionSystem } from '../src/core/systems.js';

const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const ns = arg('n', '1000,5000,10000,20000').split(',').map(Number);
const scenarios = arg('scenario', 'dense,sparse,converge').split(',');
const ticks = Number(arg('ticks', 300));
const cellSize = Number(arg('cell', 32));
const WARMUP = 120;
const DT = 1 / 60;
const STAGES = ['ai', 'move', 'proj', 'grid', 'fire', 'collide', 'mode'];

function build(scenario, n) {
  let bounds = BOUNDS;
  if (scenario === 'sparse') {
    const area = n * 2500;
    const w = Math.round(Math.sqrt(area * 1.5));
    bounds = { w, h: Math.round(area / w) };
  }
  const mode = createStress({ enemies: n / 2, projectiles: n / 2, enemyType: scenario === 'converge' ? ENEMY.CHASER : ENEMY.DUMMY });
  return createGame({ capacity: n * 2, bounds, cellSize, mode, rng: seeded(1), input: { x: 0, y: 0 } });
}

// Same order as game.js tick(), with a clock around each stage. The cross-check against the
// real tick() below flags drift if tick() is reordered.
function timedTick(g, t) {
  const { world, grid, player, bounds } = g;
  let t0 = performance.now();
  const lap = (k) => {
    const t1 = performance.now();
    t[k].push(t1 - t0);
    t0 = t1;
  };
  movePlayer(player, g.input, DT, bounds);
  enemyAISystem(world, player, DT);
  lap('ai');
  moveSystem(world, DT);
  lap('move');
  projectileSystem(world, DT, bounds);
  lap('proj');
  grid.rebuild(world, KIND.ENEMY);
  lap('grid');
  autoFire(player, world, grid, DT);
  lap('fire');
  g.kills += collisionSystem(world, grid, player, MAX_ENEMY_RADIUS);
  lap('collide');
  g.mode.update(g, DT);
  lap('mode');
}

const sorted = (a) => Float64Array.from(a).sort();
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
const f = (v) => v.toFixed(2).padStart(7);

console.log(`cell ${cellSize}, node ${process.version}, ${ticks} ticks after ${WARMUP} warmup, ms per tick`);
console.log(['scenario', 'N', 'tick', 'tick p95', ...STAGES, 'dropped'].map((h) => h.padStart(9)).join(''));
for (const scenario of scenarios) {
  for (const n of ns) {
    const g = build(scenario, n);
    for (let k = 0; k < WARMUP; k++) tick(g, DT);
    const t = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (let k = 0; k < ticks; k++) timedTick(g, t);
    const total = t.ai.map((_, k) => STAGES.reduce((acc, s) => acc + t[s][k], 0));
    const ts = sorted(total);

    const g2 = build(scenario, n); // cross-check: the real tick()
    for (let k = 0; k < WARMUP; k++) tick(g2, DT);
    const real = [];
    for (let k = 0; k < ticks; k++) {
      const t0 = performance.now();
      tick(g2, DT);
      real.push(performance.now() - t0);
    }
    const rs = sorted(real);
    const drift = Math.abs(pct(rs, 0.5) - pct(ts, 0.5)) / pct(ts, 0.5);

    console.log(
      [scenario.padStart(9), String(n).padStart(9), f(pct(ts, 0.5)).padStart(9), f(pct(ts, 0.95)).padStart(9)]
        .concat(STAGES.map((s) => f(pct(sorted(t[s]), 0.5)).padStart(9)))
        .concat(String(g.world.dropped).padStart(9))
        .join('') + (drift > 0.25 ? `  WARN real tick() median ${pct(rs, 0.5).toFixed(2)} differs ${(drift * 100).toFixed(0)}%` : ''),
    );
  }
}
