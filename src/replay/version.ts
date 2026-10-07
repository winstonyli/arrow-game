// Bump SIM_VERSION on the first sim change after a release (anything the golden replays in test/fixtures would notice);
// further changes before the next release share that bump. Goldens and pinned hashes are regenerated on every sim change.
// Stored replays with an older version are kept but flagged stale: re-simulating them would diverge.
export const SIM_VERSION = 14;
/** The sim's fixed tick rate. main.ts builds its stepper from this, so live play and replays cannot disagree. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
