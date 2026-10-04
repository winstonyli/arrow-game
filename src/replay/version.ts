// Bump SIM_VERSION whenever sim behaviour changes (anything the golden replays in test/fixtures would notice).
// Stored replays with an older version are kept but flagged stale: re-simulating them would diverge.
export const SIM_VERSION = 6;
/** The sim's fixed tick rate. main.ts builds its stepper from this, so live play and replays cannot disagree. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
