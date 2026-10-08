// Does the evolved bot (scripts/bot-params.json) beat the default smart bot on starting builds it was NOT trained on?
// For each build, runs both bots on the same seeds and reports mean survival and damage per second for each, with the paired
// difference (evolved - default) and its 95% bootstrap interval. Builds use the sweep's ids: '' = nothing, weapon.0 = the weapon at
// level 2, weapon.a / weapon.b = the weapon with that branch (see balance-sweep.ts). Training used '', chain.a and shockwave.a.
// Usage: bun scripts/compare-bots.ts [--seeds=30] [--minutes=15] [--jobs=4] [--base=5000] [--builds=id,id,...]
import { runAll, loadParams } from './lib/sweep-run.ts';
import { seeded } from '../src/core/math.ts';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const nSeeds = Number(arg('seeds', 30));
const minutes = Number(arg('minutes', 15));
const jobs = Number(arg('jobs', 4));
const base = Number(arg('base', 5000)); // held-out seeds: evolve-bot trained on 100+
const builds = arg('builds', '') ? arg('builds', '').split(',') : ['', ...['shockwave', 'chain', 'blade', 'drone'].flatMap((w) => [`${w}.0`, `${w}.a`, `${w}.b`])];
const TRAINED = new Set(['', 'chain.a', 'shockwave.a']);

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
function paired(d: number[]): [number, number, number] {
  const rng = seeded(12345);
  const ms = Array.from({ length: 2000 }, () => mean(d.map(() => d[Math.floor(rng() * d.length)]))).sort((x, y) => x - y);
  return [mean(d), ms[50], ms[1949]];
}
const mark = (lo: number, hi: number) => (lo > 0 ? ' +' : hi < 0 ? ' -' : '  ');

const seeds = Array.from({ length: nSeeds }, (_, i) => base + i);
const def = loadParams('smart'), evo = loadParams('evolved');
console.log(`compare: ${builds.length} builds x ${nSeeds} seeds (${base}+), cap ${minutes} min, ${jobs} at a time\n`);
console.log('build'.padEnd(13) + 'surv def'.padStart(9) + 'surv evo'.padStart(9) + '  d surv s (95% CI)'.padEnd(26) + 'dps def'.padStart(8) + 'dps evo'.padStart(8) + '  d dps (95% CI)');
for (const b of builds) {
  const [a, e] = [await runAll(def, minutes, jobs, seeds, b), await runAll(evo, minutes, jobs, seeds, b)];
  const [ds, slo, shi] = paired(e.map((r, i) => r.secs - a[i].secs));
  const [dd, dlo, dhi] = paired(e.map((r, i) => r.dps - a[i].dps));
  console.log(
    ((b || 'baseline') + (TRAINED.has(b) ? '*' : '')).padEnd(13) + mean(a.map((r) => r.secs)).toFixed(0).padStart(9) + mean(e.map((r) => r.secs)).toFixed(0).padStart(9) +
      `  ${ds.toFixed(0).padStart(5)} (${slo.toFixed(0)}, ${shi.toFixed(0)})${mark(slo, shi)}`.padEnd(26) +
      mean(a.map((r) => r.dps)).toFixed(1).padStart(8) + mean(e.map((r) => r.dps)).toFixed(1).padStart(8) + `  ${dd.toFixed(1)} (${dlo.toFixed(1)}, ${dhi.toFixed(1)})${mark(dlo, dhi)}`,
  );
}
console.log('\n* build used in training (different seeds)');
