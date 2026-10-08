// Shared by scripts/balance-sweep.ts and scripts/compare-bots.ts: runs one build over a list of seeds in sweep-worker.ts
// processes (BelowNormal), split into at most `jobs` contiguous batches run in parallel; results come back in seed order.
// Runs are deterministic, so every result is cached in scripts/.run-cache.jsonl, keyed by the bot numbers, build, seed, cap and a
// hash of the sim and bot sources (src/**/*.ts, lib/bot.ts, lib/sweep-worker.ts): any code change makes old entries unreachable
// and they are dropped on the next load. Delete the file to force a full re-run.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Bot } from './bot.ts';

export interface Run { secs: number; picked: boolean; dps: number }

const here = (rel: string) => new URL(rel, import.meta.url);
const cacheFile = here('../.run-cache.jsonl');
const codeHash = (() => {
  const h = createHash('sha1');
  const files = [
    ...(readdirSync(here('../../src/'), { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).sort().map((f) => here(`../../src/${f}`)),
    here('./bot.ts'), here('./sweep-worker.ts'),
  ];
  for (const f of files) h.update(readFileSync(f));
  return h.digest('hex').slice(0, 12);
})();
const cache = new Map<string, Run>();
if (existsSync(cacheFile)) {
  const lines = readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean);
  const live = lines.filter((l) => JSON.parse(l).c === codeHash);
  for (const l of live) { const j = JSON.parse(l); cache.set(j.k, { secs: j.secs, picked: j.picked, dps: j.dps }); }
  if (live.length < lines.length) writeFileSync(cacheFile, live.map((l) => l + '\n').join(''));
}
const keyOf = (bot: Bot, minutes: number, force: string, seed: number) =>
  createHash('sha1').update(JSON.stringify([bot, minutes, force, seed])).digest('hex').slice(0, 16);

function runBatch(bot: Bot, minutes: number, seeds: number[], force: string): Promise<Run[]> {
  return new Promise((resolve, reject) => {
    const spec = JSON.stringify({ params: bot.params, front: bot.front, minutes, force, seeds });
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

export async function runAll(bot: Bot, minutes: number, jobs: number, seeds: number[], force: string): Promise<Run[]> {
  const missing = seeds.filter((s) => !cache.has(keyOf(bot, minutes, force, s)));
  if (missing.length) {
    const per = Math.ceil(missing.length / jobs);
    const parts = Array.from({ length: Math.ceil(missing.length / per) }, (_, i) => missing.slice(i * per, (i + 1) * per));
    const done = (await Promise.all(parts.map((s) => runBatch(bot, minutes, s, force)))).flat();
    const lines = missing.map((s, i) => {
      const k = keyOf(bot, minutes, force, s);
      cache.set(k, done[i]);
      return JSON.stringify({ c: codeHash, k, ...done[i] }) + '\n';
    });
    appendFileSync(cacheFile, lines.join(''));
  }
  return seeds.map((s) => cache.get(keyOf(bot, minutes, force, s))!);
}
