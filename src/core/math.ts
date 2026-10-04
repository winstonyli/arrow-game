// A point or vector (positions, the camera, input) and an extent (world bounds, the view).
export type Vec = { x: number; y: number };
export type Size = { w: number; h: number };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Deterministic PRNG (mulberry32) returning floats in [0, 1).
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
