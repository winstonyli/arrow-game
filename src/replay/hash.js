// @ts-check
// FNV-1a over the sim state (world arrays, player, scalars). Equal hashes mean equal sim state; used by the
// determinism tests, the golden replays and (later) a server-side verifier.
/** @param {any} g a game from createGame */
export function stateHash(g) {
  let h = 2166136261 >>> 0;
  const mix = (/** @type {number} */ v) => {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const num = (/** @type {number} */ x) => {
    f[0] = x;
    mix(u[0]);
  };
  const w = g.world;
  for (let i = 0; i < w.high; i++) {
    mix(w.kind[i]);
    if (!w.kind[i]) continue;
    for (const k of ['x', 'y', 'vx', 'vy', 'hp', 'radius', 'life', 'cd']) num(w[k][i]);
    mix(w.type[i]);
    mix(w.gen[i]);
    mix(w.pierce[i]);
    mix(w.bounce[i]);
  }
  for (const k of ['x', 'y', 'hp', 'cd', 'invuln']) num(g.player[k]);
  num(g.time);
  num(g.xp);
  mix(g.kills);
  mix(g.level);
  mix(g.ticks);
  mix(w.freeCount);
  mix(w.high);
  mix(w.dropped);
  return h;
}
