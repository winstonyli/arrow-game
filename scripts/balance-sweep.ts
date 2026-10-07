// Paired-seed balance sweep: for each skill, runs the smart soak bot with that skill forced to the front of its pick order
// and compares it with the baseline build on the SAME seeds. Reports, per skill, the change in survival time and in damage
// per second (mean paired difference with a 95% bootstrap interval), over all runs (not just those that got the skill, so
// there is no selection bias), plus how many runs actually picked it. An interval that spans 0 means "no measurable effect".
// Dotted ids are granted at the start instead (weapon.a / weapon.b = branch at level 3, weapon.0 = the weapon at level 2 as the reference): see soak-arena --grant.
// Usage: bun scripts/balance-sweep.ts [--seeds=40] [--minutes=6] [--jobs=4] [--builds=id,id,...] [--base=1]
// Runs soak-arena.ts as child processes at BelowNormal priority; at most --jobs at once (keep it <= a quarter of the cores free).
import { spawn } from 'node:child_process';
import os from 'node:os';
import { SKILLS } from '../src/game/skills.ts';
import { seeded } from '../src/core/math.ts';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const nSeeds = Number(arg('seeds', 40));
const minutes = Number(arg('minutes', 6));
const jobs = Number(arg('jobs', 4));
const base = Number(arg('base', 1));
const builds = arg('builds', '') ? arg('builds', '').split(',') : SKILLS.map((s) => s.id);
const names = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

interface Run { secs: number; picked: boolean; dps: number }

function runOne(seed: number, force: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const args = ['scripts/soak-arena.ts', `--minutes=${minutes}`, '--bot=smart', `--seed=${seed}`, '--json=1'];
    // Dotted rows are granted at the start, since a random offer rarely reaches a level-2 fork before the bot dies: chain.a = chain, chain, chain.a (level 3 with the branch); chain.0 = chain, chain (level 2, no branch: the reference row). Other rows are forced to the front of the pick order.
    const [weapon] = force.split('.');
    if (force) args.push(force.includes('.') ? `--grant=${weapon},${weapon}${force.endsWith('.0') ? '' : `,${force}`}` : `--picks=${force}`);
    const p = spawn('bun', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    try { os.setPriority(p.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    let out = '';
    p.stdout!.on('data', (d) => (out += d));
    p.on('close', () => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith('JSON '));
      if (!line) return reject(new Error(`no JSON from seed ${seed} build "${force}"`));
      const j = JSON.parse(line.slice(5));
      const dealt = (j.dmg as number[]).reduce((a, b) => a + b, 0) + (j.up as number[]).reduce((a, b) => a + b, 0);
      resolve({ secs: j.secs, picked: force === '' || force.includes('.') || (j.skills[force] ?? 0) > 0, dps: dealt / j.secs });
    });
  });
}

async function pool<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const res: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => { while (next < tasks.length) { const i = next++; res[i] = await tasks[i](); } }));
  return res;
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
const baseline = await pool(seeds.map((s) => () => runOne(s, '')));
console.log(`baseline: survival mean ${mean(baseline.map((r) => r.secs)).toFixed(0)} s, ${mean(baseline.map((r) => r.dps)).toFixed(1)} dmg/s\n`);
console.log('skill'.padEnd(16) + 'picked'.padStart(7) + '  d survival s (95% CI)'.padEnd(30) + 'd dmg/s (95% CI)');
for (const id of builds) {
  const runs = await pool(seeds.map((s) => () => runOne(s, id)));
  const [ds, slo, shi] = paired(runs.map((r) => r.secs), baseline.map((r) => r.secs));
  const [dd, dlo, dhi] = paired(runs.map((r) => r.dps), baseline.map((r) => r.dps));
  const mark = (lo: number, hi: number) => (lo > 0 ? ' +' : hi < 0 ? ' -' : '  ');
  console.log(
    (names[id] ?? id).padEnd(16) + `${runs.filter((r) => r.picked).length}/${nSeeds}`.padStart(7) +
      `  ${ds.toFixed(0).padStart(5)} (${slo.toFixed(0)}, ${shi.toFixed(0)})${mark(slo, shi)}`.padEnd(30) +
      `${dd.toFixed(1).padStart(6)} (${dlo.toFixed(1)}, ${dhi.toFixed(1)})${mark(dlo, dhi)}`,
  );
}
