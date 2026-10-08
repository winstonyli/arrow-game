// Evolves the smart bot's steering numbers (scripts/lib/bot.ts BotParams) to survive longer, so balance sweeps measure builds
// against a stronger, less hand-tuned player. A (mu/mu_w, lambda) evolution strategy over the parameters scaled to [0, 1]:
// each generation samples `pop` candidates around the current mean, scores them (and the mean itself) on the same fresh seeds,
// and moves the mean to the rank-weighted average of the best quarter. Fitness = mean seconds survived over three builds
// (the baseline, Corona Wire and Aftershock granted at the start) x `seeds` seeds, capped at `minutes`; the builds keep the bot from
// overfitting to one. At the end the evolved mean and the defaults are compared on `heldout` seeds never used in training.
// Output: a per-generation line, then the final parameters (name, default, evolved) and the held-out comparison; the parameters
// are also written to scripts/bot-params.json (read by soak-arena --bot=evolved). Progress is checkpointed to the --state file
// every generation, so --resume continues an interrupted run. Workers run at BelowNormal priority; never more than --jobs at once.
// --target=priority evolves the card-pick order instead (one key in [0, 1] per card, sorted ascending; the steering numbers stay at
// the scripts/bot-params.json values) and writes scripts/bot-priority.json; its held-out comparison is evolved order vs PRIORITY.
// Usage: bun scripts/evolve-bot.ts [--target=params|priority] [--gens=40] [--pop=24] [--seeds=3] [--minutes=10] [--jobs=6] [--sigma=0.2] [--heldout=30] [--resume] [--race] [--out=scripts/bot-params.json] [--state=scripts/evolve-state.json]
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import os from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, BOUNDS, PARAM_KEYS, PRIORITY } from './lib/bot.ts';
import type { BotParams } from './lib/bot.ts';
import { loadParams } from './lib/sweep-run.ts';
import { seeded } from '../src/core/math.ts';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const prio = arg('target', 'params') === 'priority';
const race = process.argv.includes('--race'); // score on one seed first, then finish only the better half on the rest (about 2x faster per generation)
const gens = Number(arg('gens', 40));
const pop = Number(arg('pop', 24));
const nSeeds = Number(arg('seeds', 3));
const minutes = Number(arg('minutes', 10));
const jobs = Number(arg('jobs', 6));
const sigma0 = Number(arg('sigma', 0.2));
const heldout = Number(arg('heldout', 30));
const outPath = arg('out', prio ? 'scripts/bot-priority.json' : 'scripts/bot-params.json');
const statePath = arg('state', prio ? 'scripts/evolve-priority-state.json' : 'scripts/evolve-state.json');
const resume = process.argv.includes('--resume');
const CONDS: string[][] = [[], ['chain', 'chain', 'chain.a'], ['shockwave', 'shockwave', 'shockwave.a']];
const HELDOUT_BASE = 5000;

// --- worker pool -------------------------------------------------------------------------------------------------------
const children = new Set<ChildProcess>();
const stop = () => { for (const c of children) c.kill(); };
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('exit', stop);
let running = 0;
const waiting: (() => void)[] = [];
const slot = async () => { if (running >= jobs) await new Promise<void>((r) => waiting.push(r)); running++; };
const release = () => { running--; waiting.shift()?.(); };

// What a candidate is: steering numbers plus an optional card order (ranked ahead of PRIORITY).
interface Cand { params: BotParams; front?: string[] }

// Seconds survived for every (condition, seed) pair, in order, from one worker process.
async function evaluate(p: Cand, seeds: number[]): Promise<number[]> {
  await slot();
  try {
    const list = CONDS.flatMap((grant) => seeds.map((seed) => ({ seed, grant })));
    const out = await new Promise<string>((resolve, reject) => {
      const c = spawn(process.execPath, ['scripts/lib/eval-worker.ts', JSON.stringify({ params: p.params, front: p.front, minutes, jobs: list })], { stdio: ['ignore', 'pipe', 'inherit'] });
      children.add(c);
      try { os.setPriority(c.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
      let buf = '';
      c.stdout!.on('data', (d) => (buf += d));
      c.on('close', (code) => { children.delete(c); code === 0 ? resolve(buf) : reject(new Error(`worker exited ${code}`)); });
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT '));
    if (!line) throw new Error('worker printed no RESULT');
    return JSON.parse(line.slice(7));
  } finally { release(); }
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

// --- parameters <-> unit vector ------------------------------------------------------------------------------------------
const toUnit = (p: BotParams) => PARAM_KEYS.map((k) => (p[k] - BOUNDS[k][0]) / (BOUNDS[k][1] - BOUNDS[k][0]));
const clamp01 = (x: number) => (prio ? x : Math.min(1, Math.max(0, x))); // only the order of the card keys matters, so they need no bounds
const evoParams = prio ? loadParams('evolved') : DEFAULT_PARAMS;
const orderOf = (u: number[]): string[] => PRIORITY.map((id, i) => ({ id, i })).sort((a, b) => u[a.i] - u[b.i] || a.i - b.i).map((x) => x.id);
const fromUnit = (u: number[]): Cand => prio
  ? { params: evoParams, front: orderOf(u) }
  : { params: Object.fromEntries(PARAM_KEYS.map((k, i) => [k, +(BOUNDS[k][0] + clamp01(u[i]) * (BOUNDS[k][1] - BOUNDS[k][0])).toPrecision(4)])) as unknown as BotParams };

// --- evolution -----------------------------------------------------------------------------------------------------------
interface State { gen: number; mean: number[]; rngSeed: number; history: { gen: number; meanFit: number; bestFit: number; popMean: number }[] }
let state: State = { gen: 0, mean: prio ? PRIORITY.map((_, i) => i / (PRIORITY.length - 1)) : toUnit(DEFAULT_PARAMS),rngSeed: 20261008, history: [] };
if (resume && existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf8'));
const rng = seeded(state.rngSeed + state.gen * 7919);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

console.log(`evolve: ${gens} gens x ${pop} candidates + mean, ${nSeeds} seeds x ${CONDS.length} builds, cap ${minutes} min, ${jobs} jobs, sigma ${sigma0}, start gen ${state.gen}`);
const t0 = Date.now();
for (let g = state.gen; g < gens; g++) {
  const sigma = sigma0 * (1 - (0.8 * g) / Math.max(1, gens - 1));
  const seeds = Array.from({ length: nSeeds }, (_, j) => 100 + g * nSeeds + j); // fresh seeds each generation, shared by the whole generation
  const cands = [state.mean, ...Array.from({ length: pop }, () => state.mean.map((m) => clamp01(m + sigma * gauss())))];
  let fits: number[];
  let alive = cands.map((_, i) => i); // candidates still in the running; with --race the weaker half drops after the first seed
  if (!race) fits = await Promise.all(cands.map((u) => evaluate(fromUnit(u), seeds).then(mean)));
  else {
    const first = await Promise.all(cands.map((u) => evaluate(fromUnit(u), seeds.slice(0, 1))));
    fits = first.map(mean);
    alive = alive.sort((a, b) => fits[b] - fits[a]).slice(0, Math.max(2, Math.ceil(cands.length / 2)));
    if (!alive.includes(0)) alive.push(0); // the old mean always gets the full score so the log stays comparable
    const rest = await Promise.all(alive.map((i) => evaluate(fromUnit(cands[i]), seeds.slice(1))));
    alive.forEach((i, k) => { fits[i] = mean([...first[i], ...rest[k]]); });
  }
  const order = alive.sort((a, b) => fits[b] - fits[a]);
  const mu = Math.max(2, Math.floor(pop / 4));
  const w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wsum = w.reduce((a, b) => a + b, 0);
  state.mean = state.mean.map((_, d) => order.slice(0, mu).reduce((s, idx, r) => s + (w[r] / wsum) * cands[idx][d], 0));
  state.gen = g + 1;
  state.history.push({ gen: g + 1, meanFit: fits[0], bestFit: fits[order[0]], popMean: mean(fits.slice(1)) });
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`gen ${String(g + 1).padStart(3)}  sigma ${sigma.toFixed(3)}  old mean ${fits[0].toFixed(1)} s  best ${fits[order[0]].toFixed(1)} s  population ${mean(fits.slice(1)).toFixed(1)} s  elapsed ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// --- held-out comparison -------------------------------------------------------------------------------------------------
const evolved = fromUnit(state.mean);
const hseeds = Array.from({ length: heldout }, (_, j) => HELDOUT_BASE + j);
const chunks = (xs: number[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
// evaluate() returns results ordered by condition then seed within a chunk; regroup per condition.
async function heldoutRuns(p: Cand): Promise<number[][]> {
  const parts = await Promise.all(chunks(hseeds, 5).map((c) => evaluate(p, c).then((r) => ({ c, r }))));
  return CONDS.map((_, ci) => parts.flatMap(({ c, r }) => r.slice(ci * c.length, (ci + 1) * c.length)));
}
const [base, tuned] = await Promise.all([heldoutRuns({ params: evoParams }), heldoutRuns(evolved)]);
const label = ['baseline', 'Corona Wire', 'Aftershock'];
const boot = (d: number[]): [number, number] => { // 95% bootstrap interval of the mean paired difference
  const r = seeded(1);
  const ms = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(r() * d.length)]))).sort((a, b) => a - b);
  return [ms[50], ms[1949]];
};
console.log(`\nHeld-out comparison (${heldout} unseen seeds per build, cap ${minutes} min, mean seconds survived):`);
const rows = CONDS.map((_, i) => {
  const diff = tuned[i].map((v, j) => v - base[i][j]);
  const [lo, hi] = boot(diff);
  return `  ${label[i].padEnd(12)} default ${mean(base[i]).toFixed(1).padStart(6)}   evolved ${mean(tuned[i]).toFixed(1).padStart(6)}   difference ${mean(diff).toFixed(1).padStart(6)} (95% CI ${lo.toFixed(1)}, ${hi.toFixed(1)})`;
});
console.log(rows.join('\n'));
if (prio) console.log('\nFinal card order (picked first to last):\n  ' + evolved.front!.join(', '));
else {
  console.log('\nFinal parameters:');
  console.log('  name        default   evolved   range');
  for (const k of PARAM_KEYS) console.log(`  ${k.padEnd(10)} ${String(DEFAULT_PARAMS[k]).padStart(8)} ${String(evolved.params[k]).padStart(9)}   [${BOUNDS[k][0]}, ${BOUNDS[k][1]}]`);
}
writeFileSync(outPath, JSON.stringify({ ...(prio ? { priority: evolved.front } : { params: evolved.params }), gens: state.gen, pop, seeds: nSeeds, minutes, heldout: { seeds: heldout, base: base.map(mean), evolved: tuned.map(mean) }, generated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
console.log(`\nwritten to ${outPath}`);
console.log((prio ? 'PRIORITY ' : 'PARAMS ') + JSON.stringify(prio ? evolved.front : evolved.params));
