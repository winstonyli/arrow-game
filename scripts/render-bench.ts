// Browser render benchmark: drives a real Chrome window over CDP (no dependencies; needs Node's global WebSocket).
// Usage: node scripts/render-bench.ts [--renderer=webgl,canvas2d] [--n=1000,5000,10000,20000]
//        [--scenario=dense,converge] [--secs=13] [--shot=dir] [--mode=background|headed|headless]
// --mode: `background` (default) opens an off-screen window with Chrome's occlusion/backgrounding throttling off, so it
// neither takes focus nor slows down when other windows cover it; `headed` is the old visible window (steals focus,
// and is throttled if covered); `headless` has no window at all (GPU path may differ: compare before trusting).
// Starts its own static server and a throwaway Chrome profile; closes both when done.
// Reports the median/p95 rAF interval; sim/draw ms are the HUD's CPU-side EMAs. Frame time is the number
// that counts: draw ms cannot see GPU rasterization.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name: string, dflt: string | number): string => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${dflt}`).split('=')[1];
const renderers = arg('renderer', 'webgl,canvas2d').split(',');
const ns = arg('n', '1000,5000,10000,20000').split(',').map(Number);
const scenarios = arg('scenario', 'dense,converge').split(',');
const secs = Number(arg('secs', 13));
const shotDir = arg('shot', '');
const mode = arg('mode', 'background');
const MODE_FLAGS = {
  headed: [],
  background: ['--window-position=-32000,-32000', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  headless: ['--headless=new'],
}[mode];
if (!MODE_FLAGS) throw new Error(`unknown --mode=${mode}`);
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WEB = 8123;
const DEBUG = 9333;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The slices of the DevTools protocol this script reads.
interface CdpTarget { type: string; webSocketDebuggerUrl: string }
interface CdpMessage { id?: number; result?: unknown } // events carry no id
interface FrameSample { r: string; v: string; fs: { n: number; medianMs: number | null; p95Ms: number | null; simMs: number | null; drawMs: number | null } } // JSON turns NaN into null

const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: String(WEB) }, stdio: 'ignore' });
const chrome = spawn(CHROME, [`--remote-debugging-port=${DEBUG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'chrome-bench-'))}`, '--window-size=1100,800', ...MODE_FLAGS, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { server.kill(); chrome.kill(); };
process.on('exit', cleanup);

try {
  let pages: CdpTarget[] | undefined;
  for (let k = 0; k < 40 && !pages?.some((p) => p.type === 'page'); k++) {
    await sleep(250);
    try { pages = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()) as CdpTarget[]; } catch {} // DevTools HTTP endpoint
  }
  const page = pages?.find((p) => p.type === 'page');
  if (!page) throw new Error(`no Chrome page target on :${DEBUG}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => (ws.onopen = () => r()));
  let id = 0;
  const pending = new Map<number, (m: CdpMessage) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)) as CdpMessage; if (m.id === undefined) return; pending.get(m.id)?.(m); pending.delete(m.id); };
  // R is the method's result shape, per the protocol docs: the cast trusts Chrome.
  const cdp = <R = unknown>(method: string, params: object = {}) => new Promise<{ result: R }>((r) => { const i = ++id; pending.set(i, (m) => r(m as { result: R })); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async <T>(expr: string): Promise<T> => (await cdp<{ result: { value: T } }>('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
  await cdp('Page.enable');
  if (mode === 'headed') await cdp('Page.bringToFront');

  let gpu: string | undefined;
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  console.log('renderer  scenario        N  actual   frames  median ms  p95 ms  sim ms  draw ms');
  for (const renderer of renderers) {
    for (const scenario of scenarios) {
      for (const n of ns) {
        await cdp('Page.navigate', { url: `http://localhost:${WEB}/?stress=${n}&scenario=${scenario}&renderer=${renderer}` });
        await sleep(n >= 20000 ? secs * 2000 : secs * 1000);
        gpu ??= await evalJs<string>(`(()=>{const g=document.createElement('canvas').getContext('webgl');const e=g&&g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'n/a'})()`);
        const r = JSON.parse(await evalJs<string>('JSON.stringify({ r: arrowGame.renderer, v: document.visibilityState, fs: arrowGame.frameStats() })')) as FrameSample;
        const f = (v: number | null) => (v == null ? '-' : v.toFixed(1)).padStart(8);
        console.log(`${renderer.padEnd(9)} ${scenario.padEnd(9)} ${String(n).padStart(6)}  ${r.r.padEnd(8)}${String(r.fs.n).padStart(6)} ${f(r.fs.medianMs)} ${f(r.fs.p95Ms)} ${f(r.fs.simMs)} ${f(r.fs.drawMs)}${r.v === 'visible' ? '' : '  (tab hidden!)'}`);
        if (shotDir) writeFileSync(join(shotDir, `${renderer}-${scenario}-${n}.png`), Buffer.from((await cdp<{ data: string }>("Page.captureScreenshot")).result.data, 'base64'));
      }
    }
  }
  console.log('gpu:', gpu, ' mode:', mode);
  ws.close();
} finally {
  cleanup();
}
