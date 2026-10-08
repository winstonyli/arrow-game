// Child process for scripts/evolve-bot.ts: runs the smart bot with the given parameters over a list of (seed, grant) jobs
// in this one process (no per-run startup cost) and prints one line, `RESULT [secs, ...]`, in job order.
// argv[2] = JSON { params, minutes, jobs: [{ seed, grant: string[] }] }
import { runHeadless } from './bot.ts';
import type { BotParams } from './bot.ts';

const spec = JSON.parse(process.argv[2]) as { params: BotParams; minutes: number; jobs: { seed: number; grant: string[] }[] };
const secs = spec.jobs.map((j) => runHeadless(spec.params, j.seed, j.grant, spec.minutes).secs);
console.log('RESULT ' + JSON.stringify(secs));
