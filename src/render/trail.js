// Movement trails, presentation-only. Two kinds of mover, both reading sim state without writing it:
//  - a tapered tail behind every enemy, arrow and gem, bent through where the mover actually was: fx.js keeps
//    a short per-slot position history and `bentTail` turns two samples of it into the tail;
//  - the player and each orbit blade get the same tail from a ring of samples kept by fx.js.
export const TRAIL_MAX = 80; // px cap on a tail's length
export const TRAIL_N = 10; // history samples per mover
export const TRAIL_MID = 4; // age (in samples) of the tail's bend
export const TRAIL_END = TRAIL_N - 1; // age of the tail's tip
export const TRAIL_DT = 1 / 60; // seconds between history samples

// Writes the tail vector (from the mover back along its path) to `out`. The tail is drawn from the mover's
// centre, so `r` (its radius) is added, ramping in over the first 10 px of tail, to make the visible part
// start at the rim: a slow, large enemy still shows a tail.
// Turns the offsets from a mover's centre to its history samples at TRAIL_MID and TRAIL_END (mx, my, ex, ey)
// into the tail's bend and tip, written to `out` (mx, my, ex, ey). The tail is drawn from the mover's centre, so
// `r` (its radius) is added to the length, ramping in over the first 10 px, to make the visible part start at
// the rim: a slow, large enemy still shows a tail. Both points scale together, keeping the shape; zero if the
// mover has not moved.
export function bentTail(mx, my, ex, ey, out, r = 0) {
  const l = Math.hypot(ex, ey);
  if (l < 1e-6) {
    out.mx = out.my = out.ex = out.ey = 0;
    return;
  }
  const k = Math.min(TRAIL_MAX, l + r * Math.min(1, l / 10)) / l;
  const m = Math.hypot(mx, my) * k;
  const km = m > TRAIL_MAX ? (k * TRAIL_MAX) / m : k;
  out.mx = mx * km;
  out.my = my * km;
  out.ex = ex * k;
  out.ey = ey * k;
}
