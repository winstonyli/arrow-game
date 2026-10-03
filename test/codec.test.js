import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, toCode, fromCode, ReplayError } from '../src/replay/codec.js';
import { fakeReplay } from '../scripts/lib/fake-replay.js';

const rejects = (fn, code) =>
  assert.rejects(fn, (e) => e instanceof ReplayError && (code ? e.code === code : true));
const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof ReplayError && e.code === code);

test('validate accepts a good replay and returns it', () => {
  const r = fakeReplay({ picks: [[2, 'power']] });
  assert.equal(validate(r), r);
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
  await rejects(() => fromCode('hello'), 'bad-code');
  await rejects(() => fromCode('AG9.abc'), 'bad-code');
  await rejects(() => fromCode(code.slice(0, 20) + '!' + code.slice(21)), 'bad-code');
  await rejects(() => fromCode(code.slice(0, code.length - 12))); // truncated: corrupt or invalid
  await rejects(() => fromCode(`AG1.${'A'.repeat(400001)}`), 'too-large');
  // wrong replay version inside a valid code
  const bad = await toCode(fakeReplay());
  const v2 = JSON.stringify({ ...fakeReplay(), v: 2 });
  const stream = new Blob([v2]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  await rejects(() => fromCode(`AG1.${Buffer.from(bytes).toString('base64url')}`), 'version');
  assert.ok(bad.startsWith('AG1.'));
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
