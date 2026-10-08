// Child process for scripts/evolve-bot.ts: runs the smart bot with the given parameters over a list of (seed, grant) jobs
// in this one process (no per-run startup cost) and prints one line, `RESULT [secs, ...]`, in job order.
// argv[2] = JSON { params, front?, minutes, metric? ('secs' default | 'damage'), jobs: [{ seed, grant: string[] }] }; `front` is a card order ranked ahead of PRIORITY.
import { runHeadless } from './bot.ts';
import type { BotParams } from './bot.ts';

const spec = JSON.parse(process.argv[2]) as { params: BotParams; front?: string[]; minutes: number; metric?: string; jobs: { seed: number; grant: string[] }[] };
const secs = spec.jobs.map((j) => { const r = runHeadless(spec.params, j.seed, j.grant, spec.minutes, spec.front); return spec.metric === 'damage' ? r.dmg : r.secs; });
console.log('RESULT ' + JSON.stringify(secs));
