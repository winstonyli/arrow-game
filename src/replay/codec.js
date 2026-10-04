import { SKILLS_BY_ID } from '../game/skills.js';

export const REPLAY_VERSION = 1;
export const MAX_TICKS = 60 * 60 * 60; // one hour of play
const MAX_CODE_CHARS = 400_000;
const MAX_JSON_BYTES = 2_000_000;
const MODES = ['arena', 'rooms'];

export class ReplayError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'ReplayError';
    this.code = code;
  }
}

/**
 * @typedef {{ time: number, kills: number, level: number, room: number }} ReplayResult
 * @typedef {{ v: number, sim: number, engine: string, mode: 'arena'|'rooms', seed: number, ticks: number,
 *   inputs: number[][], picks: [number, string][], result: ReplayResult, savedAt: number }} Replay
 */

const isInt = (/** @type {any} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (/** @type {any} */ v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Structural check of untrusted data. Returns a normalized copy holding only the known fields (unknown keys,
 * including `__proto__`, are dropped), or throws ReplayError. Field order matches the recorder's. @returns {Replay}
 */
export function validate(/** @type {any} */ r) {
  const bad = (code = 'invalid') => {
    throw new ReplayError(code);
  };
  if (!r || typeof r !== 'object') bad();
  if (r.v !== REPLAY_VERSION) bad('version');
  if (!isInt(r.sim, 0, 1e6)) bad();
  if (typeof r.engine !== 'string' || r.engine.length > 32) bad();
  if (!MODES.includes(r.mode)) bad();
  if (!isInt(r.seed, 0, 0xffffffff)) bad();
  if (!isInt(r.ticks, 0, MAX_TICKS)) bad();
  if (!Array.isArray(r.inputs) || r.inputs.length > MAX_TICKS) bad();
  let sum = 0;
  for (const run of r.inputs) {
    if (!Array.isArray(run) || run.length !== 3 || !isInt(run[0], 1, MAX_TICKS) || !isInt(run[1], -127, 127) || !isInt(run[2], -127, 127)) bad();
    sum += run[0];
  }
  if (sum !== r.ticks) bad();
  if (!Array.isArray(r.picks) || r.picks.length > 5000) bad();
  let prev = 0;
  for (const p of r.picks) {
    if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0], prev, r.ticks) || typeof p[1] !== 'string' || !Object.hasOwn(SKILLS_BY_ID, p[1])) bad();
    prev = p[0];
  }
  const s = r.result;
  if (!s || typeof s !== 'object' || !isNum(s.time) || !isInt(s.kills, 0, 1e9) || !isInt(s.level, 1, 1e6) || !isInt(s.room, 0, 1e6)) bad();
  if (!isNum(r.savedAt)) bad();
  return {
    v: r.v, sim: r.sim, engine: r.engine, mode: r.mode, seed: r.seed, ticks: r.ticks,
    inputs: r.inputs.map(([n, x, y]) => [n, x, y]),
    picks: r.picks.map(([t, id]) => [t, id]),
    result: { time: s.time, kills: s.kills, level: s.level, room: s.room },
    savedAt: r.savedAt,
  };
}

const toB64 = (/** @type {Uint8Array} */ bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const fromB64 = (/** @type {string} */ t) => {
  if (!/^[A-Za-z0-9_-]*$/.test(t)) throw new ReplayError('bad-code');
  try {
    const s = atob(t.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    throw new ReplayError('bad-code');
  }
};

// Runs bytes through a (de)compression stream, refusing to produce more than `cap` bytes (decompression bombs).
async function pipe(/** @type {Uint8Array} */ bytes, /** @type {any} */ transform, /** @type {number} */ cap) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks = [];
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
export async function toCode(/** @type {Replay} */ replay) {
  const json = new TextEncoder().encode(JSON.stringify(validate(replay)));
  if (json.length > MAX_JSON_BYTES) throw new ReplayError('too-large');
  const code = typeof CompressionStream === 'undefined' ? `AG0.${toB64(json)}` : `AG1.${toB64(await pipe(json, new CompressionStream('deflate-raw'), MAX_JSON_BYTES))}`;
  if (code.length > MAX_CODE_CHARS) throw new ReplayError('too-large');
  return code;
}

/** @returns {Promise<Replay>} */
export async function fromCode(/** @type {string} */ code) {
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
