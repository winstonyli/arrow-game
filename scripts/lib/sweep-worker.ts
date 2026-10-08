// Child process for scripts/balance-sweep.ts: runs the smart bot over a list of seeds for ONE build in this one process (no per-run
// startup cost) and prints one line, `RESULT [{secs, picked, dps}, ...]`, in seed order.
// argv[2] = JSON { params, front?, minutes, force, seeds }; `front` is the bot's own card order, ranked after a forced card. `force` as in the sweep: '' = baseline, 'chain.a' / 'chain.0' = granted at the start, any other id = ranked first.
import { runHeadless } from './bot.ts';
import type { BotParams } from './bot.ts';

const spec = JSON.parse(process.argv[2]) as { params: BotParams; front?: string[]; minutes: number; force: string; seeds: number[] };
const { force } = spec;
const [weapon] = force.split('.');
const grant = force.includes('.') ? [weapon, weapon, ...(force.endsWith('.0') ? [] : [force])] : [];
const front = [...(force && !force.includes('.') ? [force] : []), ...(spec.front ?? [])];
const out = spec.seeds.map((seed) => {
  const r = runHeadless(spec.params, seed, grant, spec.minutes, front);
  return { secs: r.secs, picked: force === '' || force.includes('.') || (r.skills[force] ?? 0) > 0, dps: r.dmg / r.secs };
});
console.log('RESULT ' + JSON.stringify(out));
