// FNV-1a over the sim state (world arrays, player, scalars). Equal hashes mean equal sim state; used by the
// determinism tests, the golden replays and (later) a server-side verifier.
import type { Game } from '../game/game.ts';
import { WEAPONS } from '../game/weapons.ts';

/** `g` is a game from createGame. */
export function stateHash(g: Game): number {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => {
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const num = (x: number) => {
    f[0] = x;
    mix(u[0]);
  };
  const w = g.world;
  for (let i = 0; i < w.high; i++) {
    mix(w.kind[i]);
    if (!w.kind[i]) continue;
    for (const k of ['x', 'y', 'vx', 'vy', 'hp', 'radius', 'life', 'cd'] as const) num(w[k][i]);
    mix(w.type[i]);
    mix(w.gen[i]);
    mix(w.pierce[i]);
    mix(w.bounce[i]);
    if (w.slowT[i] !== 0 || w.burnT[i] !== 0) { // only while a status runs, so states without one hash as before
      num(w.slowT[i]);
      num(w.burnT[i]);
    }
  }
  for (const k of ['x', 'y', 'hp', 'cd', 'invuln'] as const) num(g.player[k]);
  for (const { id } of WEAPONS) mix(g.player.stats.weapons[id] ?? 0);
  const sh = g.wstate.shock;
  mix(sh.on ? 1 : 0);
  for (const v of [sh.cd, sh.x, sh.y, sh.r, sh.max]) num(v);
  num(g.wstate.chain.cd); // the zap's path and life are presentation only and follow from the sim
  for (const b of g.wstate.boom.b) {
    mix(b.phase);
    for (const v of [b.x, b.y, b.dist, b.cd]) num(v);
  }
  const fr = g.wstate.fire;
  mix(fr.head);
  mix(fr.started ? 1 : 0);
  num(fr.lx);
  num(fr.ly);
  for (let k = 0; k < fr.life.length; k++) {
    if (fr.life[k] <= 0) continue;
    mix(k);
    for (const v of [fr.x[k], fr.y[k], fr.life[k], fr.cd[k]]) num(v);
  }
  const mn = g.wstate.mines;
  mix(mn.started ? 1 : 0);
  num(mn.lx);
  num(mn.ly);
  num(mn.cd);
  for (let k = 0; k < mn.on.length; k++) {
    mix(mn.on[k]);
    if (!mn.on[k]) continue;
    num(mn.x[k]);
    num(mn.y[k]);
    num(mn.age[k]);
  }
  const mt = g.wstate.meteors;
  num(mt.cd);
  for (let k = 0; k < mt.on.length; k++) {
    mix(mt.on[k]);
    if (!mt.on[k]) continue;
    num(mt.x[k]);
    num(mt.y[k]);
    num(mt.age[k]);
  }
  const bm = g.wstate.beam;
  mix(bm.started);
  mix(bm.live);
  num(bm.angle);
  num(bm.cd);
  const dr = g.wstate.drones;
  for (let k = 0; k < dr.on.length; k++) {
    mix(dr.on[k]);
    num(dr.x[k]);
    num(dr.y[k]);
    num(dr.cd[k]);
    num(dr.tx[k]);
    num(dr.ty[k]);
    num(dr.age[k]);
  }
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
