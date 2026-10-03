// @ts-check
// Bump SIM_VERSION whenever sim behaviour changes (anything the golden replays in test/fixtures would notice).
// Stored replays with an older version are kept but flagged stale: re-simulating them would diverge.
export const SIM_VERSION = 1;
export const TICK_DT = 1 / 60;
