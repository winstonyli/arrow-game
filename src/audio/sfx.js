// Synthesized sound effects (WebAudio, no asset files). Presentation-only like fx: the sim never reads
// this; hooks call kill/boss, and main.js calls observe(game) once per frame to derive the rest (shots,
// hits, pickups, level-ups, damage, game over) from state changes.
// createSfx(ctx) takes an AudioContext (or a test fake). Nothing plays until ctx.state is 'running', which
// browsers allow only after a user gesture: call resume() from the first key press or touch.
export const MASTER_GAIN = 0.4;
const GAIN_SCALE = 4; // per-voice gains below are relative; this sets the overall level (measured offline: a kill peaks near 0.1)
export const MAX_VOICES = 24;
export const MIN_GAP = { fire: 0.045, hit: 0.035, kill: 0.03, pickup: 0.02, hurt: 0.1 }; // seconds between plays of one sound
export const STREAK_RESET = 0.5; // seconds without a pickup before the pitch run starts over
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // semitones above C5, climbed while pickups keep coming
const C5 = 523.25;
const HEAVY_RADIUS = 17; // bruisers and bosses get the heavy kill

export function createSfx(ctx, storage = null) {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  // Gentle limiting so a pile-up of kills cannot clip.
  comp.threshold.value = -12;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  master.connect(comp);
  comp.connect(ctx.destination);
  let muted = false;
  try {
    muted = storage?.getItem('arrow-muted') === '1';
  } catch {}
  master.gain.value = muted ? 0 : MASTER_GAIN;

  // One second of white noise, shared by every noise voice.
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  let voices = 0;
  const last = {};
  const jitter = (amt) => 1 + (Math.random() * 2 - 1) * amt;

  const live = () => ctx.state === 'running';
  // True if sound `name` may play now (not muted, not too soon after its last play, voices free).
  function allow(name) {
    if (muted || !live() || voices >= MAX_VOICES) return false;
    const t = ctx.currentTime;
    if (name in last && t - last[name] < (MIN_GAP[name] ?? 0)) return false;
    last[name] = t;
    return true;
  }

  // A tone gliding from f0 to f1 over dur seconds with a fast attack and an exponential decay.
  function tone({ f0, f1 = f0, dur, type = 'sine', gain = 0.3, at = 0 }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * GAIN_SCALE, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    voices++;
    o.onended = () => voices--;
    o.stop(t + dur + 0.02);
  }

  // Band-passed noise sweeping from f0 to f1 over dur seconds.
  function noise({ f0, f1 = f0, q = 1, dur, gain = 0.3, at = 0 }) {
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * GAIN_SCALE, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(master);
    s.start(t);
    voices++;
    s.onended = () => voices--;
    s.stop(t + dur + 0.02);
  }

  let streak = 0;
  let lastPickup = -Infinity;

  // Baselines for observe(); reset when a new game starts.
  let seen = null;
  let prev = null;
  let prevHits = 0;

  const sfx = {
    get muted() {
      return muted;
    },

    resume() {
      if (ctx.state === 'suspended') ctx.resume?.();
    },

    toggleMute() {
      muted = !muted;
      master.gain.value = muted ? 0 : MASTER_GAIN;
      try {
        storage?.setItem('arrow-muted', muted ? '1' : '0');
      } catch {}
      return muted;
    },

    fire() {
      if (!allow('fire')) return;
      noise({ f0: 2600 * jitter(0.08), f1: 700, q: 2, dur: 0.07, gain: 0.3 });
      tone({ f0: 520 * jitter(0.08), f1: 260, dur: 0.05, type: 'triangle', gain: 0.08 });
    },

    hit() {
      if (!allow('hit')) return;
      tone({ f0: 900 * jitter(0.1), f1: 500, dur: 0.035, type: 'square', gain: 0.12 });
    },

    // `radius` is the dead enemy's radius; big ones sound heavier.
    kill(radius = 10) {
      if (!allow('kill')) return;
      if (radius >= HEAVY_RADIUS) {
        tone({ f0: 160 * jitter(0.05), f1: 40, dur: 0.28, type: 'sawtooth', gain: 0.22 });
        noise({ f0: 900, f1: 120, q: 0.8, dur: 0.22, gain: 0.28 });
      } else {
        tone({ f0: 420 * jitter(0.1), f1: 110, dur: 0.12, type: 'triangle', gain: 0.2 });
        noise({ f0: 1800, f1: 500, q: 1, dur: 0.06, gain: 0.14 });
      }
    },

    // Rising pentatonic blips while pickups keep coming; the run restarts after STREAK_RESET.
    pickup() {
      if (!allow('pickup')) return;
      const t = ctx.currentTime;
      streak = t - lastPickup > STREAK_RESET ? 0 : Math.min(PENTATONIC.length - 1, streak + 1);
      lastPickup = t;
      tone({ f0: C5 * 2 ** (PENTATONIC[streak] / 12), dur: 0.11, type: 'sine', gain: 0.16 });
      tone({ f0: C5 * 2 ** ((PENTATONIC[streak] + 12) / 12), dur: 0.06, type: 'sine', gain: 0.05 });
    },

    levelUp() {
      if (muted || !live()) return;
      [0, 4, 7, 12].forEach((s, k) => tone({ f0: C5 * 2 ** (s / 12), dur: 0.18, type: 'triangle', gain: 0.2, at: k * 0.07 }));
    },

    hurt() {
      if (!allow('hurt')) return;
      tone({ f0: 140, f1: 55, dur: 0.22, type: 'sawtooth', gain: 0.28 });
      noise({ f0: 1200, f1: 200, q: 0.7, dur: 0.18, gain: 0.22 });
    },

    boss() {
      if (muted || !live()) return;
      tone({ f0: 55, f1: 220, dur: 0.9, type: 'sawtooth', gain: 0.22 });
      noise({ f0: 200, f1: 1500, q: 0.6, dur: 0.9, gain: 0.12 });
    },

    gameOver() {
      if (muted || !live()) return;
      tone({ f0: 330, f1: 70, dur: 1.1, type: 'triangle', gain: 0.25 });
    },

    // Derives shots, hits, pickups, level-ups, damage and game over from state changes since the last call.
    // A different game object (restart) resets the baselines instead of firing sounds.
    observe(game) {
      const { player, fx } = game;
      const hits = fx ? fx.hits : 0;
      if (seen !== game) {
        seen = game;
        prev = { cd: player.cd, hp: player.hp, xp: game.xp, level: game.level, over: game.over };
        prevHits = hits;
        return;
      }
      if (player.cd > prev.cd + 1e-9) sfx.fire(); // the cooldown was reset: a volley left
      if (hits > prevHits) sfx.hit();
      if (player.hp < prev.hp) sfx.hurt();
      if (game.level > prev.level) sfx.levelUp();
      else if (game.xp > prev.xp) sfx.pickup();
      if (game.over && !prev.over) sfx.gameOver();
      prev.cd = player.cd;
      prev.hp = player.hp;
      prev.xp = game.xp;
      prev.level = game.level;
      prev.over = game.over;
      prevHits = hits;
    },
  };
  return sfx;
}
