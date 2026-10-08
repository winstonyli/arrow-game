// Paired-seed balance sweep: for each skill, runs the smart soak bot with that skill forced to the front of its pick order
// and compares it with the baseline build on the SAME seeds. Reports, per skill, the change in survival time and in damage
// per second (mean paired difference with a 95% bootstrap interval), over all runs (not just those that got the skill, so
// there is no selection bias), plus how many runs actually picked it. An interval that spans 0 means "no measurable effect".
// Dotted ids are granted at the start instead (weapon.a / weapon.b = branch at level 3, weapon.0 = the weapon at level 2 as the reference): see soak-arena --grant.
// With --early=1 a build stops taking seeds (in steps of 10, from 20) once the damage-per-second interval excludes 0; its row then
// shows fewer than --seeds runs. Repeated looks inflate false positives a little, so use it to screen and rerun survivors in full.
// Usage: bun scripts/balance-sweep.ts [--seeds=40] [--minutes=6] [--jobs=4] [--builds=id,id,...] [--base=1] [--bot=smart|evolved] [--early=1]
// Runs scripts/lib/sweep-worker.ts child processes (each does a batch of seeds in one process) at BelowNormal priority; at most --jobs at once (keep it <= a quarter of the cores free).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { SKILLS } from '../src/game/skills.ts';
import { seeded } from '../src/core/math.ts';
import { DEFAULT_PARAMS } from './lib/bot.ts';
import type { BotParams } from './lib/bot.ts';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const nSeeds = Number(arg('seeds', 40));
const minutes = Number(arg('minutes', 6));
const jobs = Number(arg('jobs', 4));
const base = Number(arg('base', 1));
const early = arg('early', '') !== '';
const builds = arg('builds', '') ? arg('builds', '').split(',') : SKILLS.map((s) => s.id);
const names = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));
const params: BotParams = arg('bot', 'smart') === 'evolved' ? { ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(new URL('./bot-params.json', import.meta.url), 'utf8')).params } : DEFAULT_PARAMS;

interface Run { secs: number; picked: boolean; dps: number }

// Dotted builds are granted at the start, since a random offer rarely reaches a level-2 fork before the bot dies: chain.a = chain, chain, chain.a (level 3 with the branch); chain.0 = chain, chain (level 2, no branch: the reference row). Other builds are ranked first in the pick order.
function runBatch(seeds: number[], force: string): Promise<Run[]> {
  return new Promise((resolve, reject) => {
    const spec = JSON.stringify({ params, minutes, force, seeds });
    const p = spawn(process.execPath, ['scripts/lib/sweep-worker.ts', spec], { stdio: ['ignore', 'pipe', 'inherit'] });
    try { os.setPriority(p.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    let out = '';
    p.stdout!.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT '));
      if (code !== 0 || !line) return reject(new Error(`worker failed for build "${force}" (exit ${code})`));
      resolve(JSON.parse(line.slice(7)));
    });
  });
}

// All seeds of one build, split into at most `jobs` contiguous batches run in parallel; results are in seed order.
async function runAll(seeds: number[], force: string): Promise<Run[]> {
  const per = Math.ceil(seeds.length / jobs);
  const parts = Array.from({ length: Math.ceil(seeds.length / per) }, (_, i) => seeds.slice(i * per, (i + 1) * per));
  return (await Promise.all(parts.map((s) => runBatch(s, force)))).flat();
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
// Mean of the paired differences with a 95% percentile-bootstrap interval (seeded, so the report is reproducible).
function paired(a: number[], b: number[]): [number, number, number] {
  const d = a.map((v, i) => v - b[i]);
  const rng = seeded(12345);
  const ms: number[] = [];
  for (let r = 0; r < 2000; r++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(rng() * d.length)]; ms.push(s / d.length); }
  ms.sort((x, y) => x - y);
  return [mean(d), ms[Math.floor(0.025 * ms.length)], ms[Math.floor(0.975 * ms.length)]];
}

const seeds = Array.from({ length: nSeeds }, (_, i) => base + i);
console.log(`sweep: ${builds.length} builds x ${nSeeds} seeds, ${minutes} min each, ${jobs} at a time`);
const baseline = await runAll(seeds, '');
console.log(`baseline: survival mean ${mean(baseline.map((r) => r.secs)).toFixed(0)} s, ${mean(baseline.map((r) => r.dps)).toFixed(1)} dmg/s\n`);
console.log('skill'.padEnd(16) + 'picked'.padStart(7) + '  d survival s (95% CI)'.padEnd(30) + 'd dmg/s (95% CI)');
for (const id of builds) {
  let runs = await runAll(early ? seeds.slice(0, Math.min(20, nSeeds)) : seeds, id);
  // Early stop: add 10 seeds at a time until the dmg/s interval excludes 0 or the seeds run out.
  while (early && runs.length < nSeeds && (([, lo, hi]) => lo <= 0 && hi >= 0)(paired(runs.map((r) => r.dps), baseline.slice(0, runs.length).map((r) => r.dps)))) {
    runs = runs.concat(await runAll(seeds.slice(runs.length, Math.min(nSeeds, runs.length + 10)), id));
  }
  const bl = baseline.slice(0, runs.length);
  const [ds, slo, shi] = paired(runs.map((r) => r.secs), bl.map((r) => r.secs));
  const [dd, dlo, dhi] = paired(runs.map((r) => r.dps), bl.map((r) => r.dps));
  const mark = (lo: number, hi: number) => (lo > 0 ? ' +' : hi < 0 ? ' -' : '  ');
  console.log(
    (names[id] ?? id).padEnd(16) + `${runs.filter((r) => r.picked).length}/${runs.length}`.padStart(7) +
      `  ${ds.toFixed(0).padStart(5)} (${slo.toFixed(0)}, ${shi.toFixed(0)})${mark(slo, shi)}`.padEnd(30) +
      `${dd.toFixed(1).padStart(6)} (${dlo.toFixed(1)}, ${dhi.toFixed(1)})${mark(dlo, dhi)}`,
  );
}
