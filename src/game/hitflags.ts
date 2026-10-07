// The hit flags hitEnemy reads (see hit.ts). Apart from hit.ts so coverage.ts can use them without an import cycle.
export const HIT_CRIT = 1; // may crit
export const HIT_KNOCK = 2; // may be pushed back (Personal Space)
export const HIT_NOBLAST = 4; // its kills do not explode
export const HIT_STATUS = 8; // a surviving hit starts Frost and Ignite
export const HIT_TICK = 16; // a slice of continuous damage (burn, fire): the hit-flash and hit audio ignore it
export const HIT_SHOVE = 32; // with HIT_KNOCK: pushes at least SHOVE_PX even without Personal Space (Aftershock)
