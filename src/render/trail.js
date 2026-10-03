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

// Writes the tail vector (from the mover back along its path) to `out`. The tail is drawn from the mover's
// centre, so `r` (its radius) is added, ramping in over the first 10 px of tail, to make the visible part
// start at the rim: a slow, large enemy still shows a tail.
export function tailVec(vx, vy, out, r = 0) {
  let tx = -vx * TRAIL_TIME;
  let ty = -vy * TRAIL_TIME;
  const l = Math.hypot(tx, ty);
  const want = Math.min(TRAIL_MAX, l + r * Math.min(1, l / 10));
  if (l > 0) {
    tx *= want / l;
    ty *= want / l;
  }
  out.x = tx;
  out.y = ty;
}
