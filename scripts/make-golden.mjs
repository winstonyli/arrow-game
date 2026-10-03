// Regenerates test/fixtures/golden-<mode>.json. Run after bumping SIM_VERSION when sim behaviour changed on purpose.
// Refuses to overwrite a fixture whose hash would change without a SIM_VERSION bump (pass --force to override).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { driveLive } from './lib/drive.js';
import { stateHash } from '../src/replay/hash.js';
import { SIM_VERSION } from '../src/replay/version.js';

const OUT = new URL('../test/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const CASES = [['arena', 20261003, 5400], ['rooms', 20261003, 5400]];
let failed = false;
for (const [mode, seed, maxTicks] of CASES) {
  const { game, replay } = driveLive({ mode, seed, maxTicks });
  replay.savedAt = 0; // fixtures are not timestamped
  replay.engine = 'v8';
  const fixture = { replay, hash: stateHash(game) };
  const file = new URL(`golden-${mode}.json`, OUT);
  if (existsSync(file) && !process.argv.includes('--force')) {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    if (old.replay.sim === SIM_VERSION && old.hash !== fixture.hash) {
      console.error(`${mode}: sim behaviour changed but SIM_VERSION is still ${SIM_VERSION}. Bump it in src/replay/version.js, then rerun.`);
      failed = true;
      continue;
    }
  }
  if (replay.picks.length === 0) console.warn(`${mode}: no skill picks in this run; raise maxTicks so the fixture exercises picks`);
  writeFileSync(file, JSON.stringify(fixture));
  console.log(`${mode}: ${replay.ticks} ticks, ${replay.picks.length} picks, hash ${fixture.hash}`);
}
process.exitCode = failed ? 1 : 0;
