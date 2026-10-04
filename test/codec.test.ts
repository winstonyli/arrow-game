import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, toCode, fromCode, ReplayError, MAX_TICKS } from '../src/replay/codec.ts';
import type { ReplayErrorCode } from '../src/replay/codec.ts';
import { fakeReplay } from '../scripts/lib/fake-replay.js';

const rejects = (fn: () => Promise<unknown>, code?: ReplayErrorCode) =>
  assert.rejects(fn, (e) => e instanceof ReplayError && (code ? e.code === code : true));
const throwsCode = (fn: () => unknown, code: ReplayErrorCode) =>
  assert.throws(fn, (e) => e instanceof ReplayError && e.code === code);

test('validate accepts a good replay and returns an equal copy', () => {
  const r = fakeReplay({ picks: [[2, 'power']] });
  assert.deepEqual(validate(r), r);
  assert.notEqual(validate(r), r);
});

test('validate rejects structural problems', () => {
  throwsCode(() => validate(null), 'invalid');
  throwsCode(() => validate(fakeReplay({ v: 2 })), 'version');
  throwsCode(() => validate(fakeReplay({ mode: 'duel' })), 'invalid');
  throwsCode(() => validate(fakeReplay({ seed: -1 })), 'invalid');
  throwsCode(() => validate(fakeReplay({ seed: 2 ** 32 })), 'invalid');
  throwsCode(() => validate(fakeReplay({ ticks: 6 })), 'invalid'); // run lengths must sum to ticks
  throwsCode(() => validate(fakeReplay({ inputs: [[5, 128, 0]], ticks: 5 })), 'invalid');
  throwsCode(() => validate(fakeReplay({ inputs: [[0, 0, 0], [5, 0, 0]], ticks: 5 })), 'invalid');
  throwsCode(() => validate(fakeReplay({ picks: [[9, 'power']] })), 'invalid'); // beyond ticks
  throwsCode(() => validate(fakeReplay({ picks: [[3, 'power'], [2, 'power']] })), 'invalid'); // not sorted
  throwsCode(() => validate(fakeReplay({ picks: [[1, 'not-a-skill']] })), 'invalid');
  throwsCode(() => validate(fakeReplay({ result: { time: NaN } })), 'invalid');
  throwsCode(() => validate(fakeReplay({ ticks: 216001, inputs: [[216001, 0, 0]] })), 'invalid');
});

test('a code round-trips', async () => {
  const r = fakeReplay({ picks: [[2, 'power']] });
  const code = await toCode(r);
  assert.match(code, /^AG1\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await fromCode(code), r);
});

test('fromCode tolerates surrounding whitespace', async () => {
  const r = fakeReplay();
  assert.deepEqual(await fromCode(`  ${await toCode(r)}\n`), r);
});

test('fromCode rejects junk, truncation, bad characters, wrong version and bombs', async () => {
  const code = await toCode(fakeReplay());
  assert.ok(code.startsWith('AG1.')); // compressed, so the corruptions below hit a real deflate stream
  await rejects(() => fromCode('hello'), 'bad-code');
  await rejects(() => fromCode('AG9.abc'), 'bad-code');
  await rejects(() => fromCode(code.slice(0, 20) + '!' + code.slice(21)), 'bad-code');
  await rejects(() => fromCode(code.slice(0, code.length - 12))); // truncated: corrupt or invalid
  await rejects(() => fromCode(`AG1.${'A'.repeat(400001)}`), 'too-large');
  // wrong replay version inside a valid code
  const v2 = JSON.stringify({ ...fakeReplay(), v: 2 });
  const stream = new Blob([v2]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  await rejects(() => fromCode(`AG1.${Buffer.from(bytes).toString('base64url')}`), 'version');
  // decompression bomb: 3 MB of zeros deflates to a few KB
  const zeros = new Blob([new Uint8Array(3_000_000)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const zb = new Uint8Array(await new Response(zeros).arrayBuffer());
  await rejects(() => fromCode(`AG1.${Buffer.from(zb).toString('base64url')}`), 'too-large');
});

test('AG0 (uncompressed) codes decode too', async () => {
  const r = fakeReplay();
  const code = `AG0.${Buffer.from(JSON.stringify(r)).toString('base64url')}`;
  assert.deepEqual(await fromCode(code), r);
});

// Deterministic pseudo-random replays with `runs` input runs of one tick each (incompressible-ish).
function noisyReplay(runs: number, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) % 255) - 127;
  return fakeReplay({ ticks: runs, inputs: Array.from({ length: runs }, () => [1, rnd(), rnd()]), result: { time: runs / 60 } });
}

test('validate returns a normalized copy: unknown fields and __proto__ dropped', () => {
  const r = fakeReplay({ picks: [[2, 'power']] });
  const junk = JSON.parse(JSON.stringify({ ...r, extra: 'x', result: { ...r.result, bonus: 1 } }).replace('{', '{"__proto__":{"polluted":1},'));
  const v = validate(junk);
  assert.deepEqual(v, r);
  assert.equal(Object.hasOwn(v, '__proto__'), false);
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.equal(({} as { polluted?: unknown }).polluted, undefined); // cast: probes Object.prototype for pollution
  assert.notEqual(v.inputs, junk.inputs); // a copy, not the caller's arrays
  assert.deepEqual(Object.keys(v), ['v', 'sim', 'engine', 'mode', 'seed', 'ticks', 'inputs', 'picks', 'result', 'savedAt']);
});

test('toCode refuses replays fromCode would refuse (too-large)', async () => {
  await rejects(() => toCode(noisyReplay(MAX_TICKS)), 'too-large'); // JSON over 2 MB
  await rejects(() => toCode(noisyReplay(150000)), 'too-large'); // JSON under 2 MB, code over 400,000 chars
});

test('any code toCode accepts round-trips through fromCode', async () => {
  for (const runs of [1, 1000, 50000, 75000, 90000, 100000, 120000]) {
    const r = noisyReplay(runs, runs);
    let code;
    try {
      code = await toCode(r);
    } catch (e) {
      assert.ok(e instanceof ReplayError && e.code === 'too-large', `runs ${runs}: ${e}`);
      continue;
    }
    assert.ok(code.length <= 400000);
    assert.deepEqual(await fromCode(code), r, `runs ${runs}`);
  }
});
