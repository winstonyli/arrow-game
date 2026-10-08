// Shared by scripts/balance-sweep.ts and scripts/compare-bots.ts: runs one build over a list of seeds in sweep-worker.ts
// processes (BelowNormal), split into at most `jobs` contiguous batches run in parallel; results come back in seed order.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from './bot.ts';
import type { BotParams } from './bot.ts';

export interface Run { secs: number; picked: boolean; dps: number }

export const loadParams = (bot: string): BotParams =>
  bot === 'evolved' ? { ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(new URL('../bot-params.json', import.meta.url), 'utf8')).params } : DEFAULT_PARAMS;

function runBatch(params: BotParams, minutes: number, seeds: number[], force: string): Promise<Run[]> {
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

export async function runAll(params: BotParams, minutes: number, jobs: number, seeds: number[], force: string): Promise<Run[]> {
  const per = Math.ceil(seeds.length / jobs);
  const parts = Array.from({ length: Math.ceil(seeds.length / per) }, (_, i) => seeds.slice(i * per, (i + 1) * per));
  return (await Promise.all(parts.map((s) => runBatch(params, minutes, s, force)))).flat();
}
