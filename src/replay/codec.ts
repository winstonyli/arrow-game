import { SKILLS_BY_ID } from '../game/skills.ts';
import type { ModeName } from '../game/game.ts';

export const REPLAY_VERSION = 1;
export const MAX_TICKS = 60 * 60 * 60; // one hour of play
const MAX_CODE_CHARS = 400_000;
const MAX_JSON_BYTES = 2_000_000;
// Typed `unknown[]` so `includes` takes untrusted values; `satisfies` still checks every entry is a ModeName.
const MODES: readonly unknown[] = ['arena', 'rooms'] satisfies readonly ModeName[];

// 'engine' and 'mismatch' are thrown by main.ts's import check (verify failed), not by the codec itself.
export type ReplayErrorCode = 'invalid' | 'version' | 'bad-code' | 'too-large' | 'unsupported' | 'corrupt' | 'desync' | 'engine' | 'mismatch';

export class ReplayError extends Error {
  declare code: ReplayErrorCode; // `declare`: no class-field emit, so the property is still set only in the constructor
  constructor(code: ReplayErrorCode) {
    super(code);
    this.name = 'ReplayError';
    this.code = code;
  }
}

/** The outcome of a run. Every mode fills every field; arena's `room` is always 0. */
export interface ReplayResult {
  time: number;
  kills: number;
  level: number;
  room: number;
}
/** One run of identical quantized input: `n` ticks of (qx, qy). */
export type InputRun = [n: number, qx: number, qy: number];
export type ReplayInputs = InputRun[];
/** A skill pick, applied before tick number `tick`. */
export type ReplayPick = [tick: number, skillId: string];
export interface Replay {
  v: number;
  sim: number;
  engine: string;
  mode: ModeName;
  seed: number;
  ticks: number;
  inputs: ReplayInputs;
  picks: ReplayPick[];
  result: ReplayResult;
  savedAt: number;
}
/** A store index entry: a replay's summary (see store.ts). */
export interface ReplayEntry extends ReplayResult {
  mode: ModeName;
  seed: number;
  label: string;
  savedAt: number;
  sim: number;
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = (v: unknown): v is readonly unknown[] => Array.isArray(v);
const isModeName = (v: unknown): v is ModeName => MODES.includes(v);
/** Views an untrusted object's fields as unknowns, or null when it is not an object. */
export const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null; // every field read through it is checked before use
const isRun = (run: unknown): run is InputRun =>
  isArr(run) && run.length === 3 && isInt(run[0], 1, MAX_TICKS) && isInt(run[1], -127, 127) && isInt(run[2], -127, 127);
const isPick = (p: unknown, lo: number, hi: number): p is ReplayPick =>
  isArr(p) && p.length === 2 && isInt(p[0], lo, hi) && typeof p[1] === 'string' && Object.hasOwn(SKILLS_BY_ID, p[1]);

/**
 * Structural check of untrusted data. Returns a normalized copy holding only the known fields (unknown keys,
 * including `__proto__`, are dropped), or throws ReplayError. Field order matches the recorder's.
 */
export function validate(r: unknown): Replay {
  function bad(code: ReplayErrorCode = 'invalid'): never {
    throw new ReplayError(code);
  }
  const o = asRecord(r);
  if (!o) bad();
  if (o.v !== REPLAY_VERSION) bad('version');
  if (!isInt(o.sim, 0, 1e6)) bad();
  if (typeof o.engine !== 'string' || o.engine.length > 32) bad();
  if (!isModeName(o.mode)) bad();
  if (!isInt(o.seed, 0, 0xffffffff)) bad();
  if (!isInt(o.ticks, 0, MAX_TICKS)) bad();
  if (!isArr(o.inputs) || o.inputs.length > MAX_TICKS) bad();
  let sum = 0;
  const inputs: ReplayInputs = [];
  for (const run of o.inputs) {
    if (!isRun(run)) bad();
    sum += run[0];
    const [n, x, y] = run;
    inputs.push([n, x, y]);
  }
  if (sum !== o.ticks) bad();
  if (!isArr(o.picks) || o.picks.length > 5000) bad();
  let prev = 0;
  const picks: ReplayPick[] = [];
  for (const p of o.picks) {
    if (!isPick(p, prev, o.ticks)) bad();
    prev = p[0];
    const [t, id] = p;
    picks.push([t, id]);
  }
  const s = asRecord(o.result);
  if (!s || !isNum(s.time) || !isInt(s.kills, 0, 1e9) || !isInt(s.level, 1, 1e6) || !isInt(s.room, 0, 1e6)) bad();
  if (!isNum(o.savedAt)) bad();
  return {
    v: o.v, sim: o.sim, engine: o.engine, mode: o.mode, seed: o.seed, ticks: o.ticks,
    inputs,
    picks,
    result: { time: s.time, kills: s.kills, level: s.level, room: s.room },
    savedAt: o.savedAt,
  };
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const fromB64 = (t: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(t)) throw new ReplayError('bad-code');
  try {
    const s = atob(t.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    throw new ReplayError('bad-code');
  }
};

// Runs bytes through a (de)compression stream, refusing to produce more than `cap` bytes (decompression bombs).
async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream, cap: number) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        reader.cancel().catch(() => {});
        throw new ReplayError('too-large');
      }
      chunks.push(value);
    }
  } catch (e) {
    throw e instanceof ReplayError ? e : new ReplayError('corrupt');
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Share code: `AG1.` + base64url(deflate-raw(JSON)), or `AG0.` + base64url(JSON) where CompressionStream is missing. */
// Copy applies the same limits as import, so every code we hand out can be read back (ReplayError 'too-large').
export async function toCode(replay: Replay): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(validate(replay)));
  if (json.length > MAX_JSON_BYTES) throw new ReplayError('too-large');
  const code = typeof CompressionStream === 'undefined' ? `AG0.${toB64(json)}` : `AG1.${toB64(await pipe(json, new CompressionStream('deflate-raw'), MAX_JSON_BYTES))}`;
  if (code.length > MAX_CODE_CHARS) throw new ReplayError('too-large');
  return code;
}

export async function fromCode(code: string): Promise<Replay> {
  if (typeof code !== 'string' || code.length > MAX_CODE_CHARS) throw new ReplayError('too-large');
  const m = /^(AG[01])\.([\s\S]*)$/.exec(code.trim());
  if (!m) throw new ReplayError('bad-code');
  let bytes = fromB64(m[2]);
  if (m[1] === 'AG1') {
    if (typeof DecompressionStream === 'undefined') throw new ReplayError('unsupported');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
  } else if (bytes.length > MAX_JSON_BYTES) throw new ReplayError('too-large');
  let obj;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ReplayError('corrupt');
  }
  return validate(obj);
}
