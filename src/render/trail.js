// Movement trails, presentation-only. Two kinds, both reading sim state without writing it:
//  - a tapered tail behind every enemy, arrow and gem: the renderers draw it from the entity's velocity
//    (`tailVec`), so it costs no history and a recycled slot can never leave a ghost;
//  - a short sampled position history for the player and each orbit blade (kept by fx.js), drawn as fading
//    dots, because those follow curves a straight tail would get wrong.
export const TRAIL_TIME = 0.15; // seconds of motion a tail covers
export const TRAIL_MAX = 80; // px cap on a tail's length
export const TRAIL_N = 10; // history samples per tracked mover
export const TRAIL_DT = 1 / 60; // seconds between history samples
export const TRAIL_ALPHA = 0.3; // dot alpha at the newest history sample

// Writes the tail vector (from the mover back along its path) to `out`.
export function tailVec(vx, vy, out) {
  let tx = -vx * TRAIL_TIME;
  let ty = -vy * TRAIL_TIME;
  const l = Math.hypot(tx, ty);
  if (l > TRAIL_MAX) {
    tx *= TRAIL_MAX / l;
    ty *= TRAIL_MAX / l;
  }
  out.x = tx;
  out.y = ty;
}
