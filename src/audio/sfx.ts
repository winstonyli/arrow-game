// Synthesized sound effects (WebAudio, no asset files). Presentation-only like fx: the sim never reads
// this; hooks call kill/boss, and main.js calls observe(game) once per frame to derive the rest (shots,
// hits, pickups, level-ups, damage, game over) from state changes.
// createSfx(ctx) takes an AudioContext (or a test fake). Nothing plays until ctx.state is 'running', which
// browsers allow only after a user gesture: call resume() from the first key press or touch.
import type { Game } from '../game/game.ts';

export const MASTER_GAIN = 0.4;
const ATTACK = 0.014; // seconds; slower than a click so shots and hits thump instead of snap
const TONE_CUTOFF = 3500; // Hz, master low-pass that takes the edge off everything
const GAIN_SCALE = 4; // per-voice gains below are relative; this sets the overall level (measured offline: a kill peaks near 0.1)
export const MAX_VOICES = 24;
export type SoundName = 'fire' | 'hit' | 'kill' | 'pickup' | 'hurt';
export const MIN_GAP: Record<SoundName, number> = { fire: 0.045, hit: 0.035, kill: 0.03, pickup: 0.02, hurt: 0.1 }; // seconds between plays of one sound
export const STREAK_RESET = 0.5; // seconds without a pickup before the pitch run starts over
export const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // semitones above C5, climbed while pickups keep coming
const C5 = 523.25;
const HEAVY_RADIUS = 17; // bruisers and bosses get the heavy kill

type ToneOptions = { f0: number; f1?: number; dur: number; type?: OscillatorType; gain?: number; at?: number };
type NoiseOptions = { f0: number; f1?: number; q?: number; dur: number; gain?: number; at?: number };
type Baseline = { cd: number; hp: number; xp: number; level: number; over: boolean };

export function createSfx(ctx: AudioContext, storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  // Gentle limiting so a pile-up of kills cannot clip.
  comp.threshold.value = -12;
  comp.knee.value = 12;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = TONE_CUTOFF;
  soften.Q.value = 0.5;
  master.connect(soften);
  soften.connect(comp);
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
  const last: Partial<Record<SoundName, number>> = {};
  const jitter = (amt: number) => 1 + (Math.random() * 2 - 1) * amt;

  const live = () => ctx.state === 'running';
  // True if sound `name` may play now (not muted, not too soon after its last play, voices free).
  function allow(name: SoundName) {
    if (muted || !live() || voices >= MAX_VOICES) return false;
    const t = ctx.currentTime;
    if (name in last && t - last[name]! < (MIN_GAP[name] ?? 0)) return false;
    last[name] = t;
    return true;
  }

  // A tone gliding from f0 to f1 over dur seconds with a fast attack and an exponential decay.
  function tone({ f0, f1 = f0, dur, type = 'sine', gain = 0.3, at = 0 }: ToneOptions) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * GAIN_SCALE, t + ATTACK);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    voices++;
    o.onended = () => voices--;
    o.stop(t + dur + 0.02);
  }

  // Band-passed noise sweeping from f0 to f1 over dur seconds.
  function noise({ f0, f1 = f0, q = 1, dur, gain = 0.3, at = 0 }: NoiseOptions) {
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
    g.gain.exponentialRampToValueAtTime(gain * GAIN_SCALE, t + ATTACK);
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
  let seen: Game | null = null;
  let prev: Baseline | null = null;
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
      noise({ f0: 1500 * jitter(0.08), f1: 500, q: 0.8, dur: 0.1, gain: 0.16 });
      tone({ f0: 330 * jitter(0.08), f1: 200, dur: 0.09, type: 'sine', gain: 0.1 });
    },

    hit() {
      if (!allow('hit')) return;
      tone({ f0: 420 * jitter(0.1), f1: 260, dur: 0.07, type: 'sine', gain: 0.14 });
    },

    // `radius` is the dead enemy's radius; big ones sound heavier.
    kill(radius = 10) {
      if (!allow('kill')) return;
      if (radius >= HEAVY_RADIUS) {
        tone({ f0: 150 * jitter(0.05), f1: 45, dur: 0.34, type: 'triangle', gain: 0.26 });
        noise({ f0: 600, f1: 120, q: 0.6, dur: 0.26, gain: 0.14 });
      } else {
        tone({ f0: 360 * jitter(0.1), f1: 120, dur: 0.16, type: 'sine', gain: 0.22 });
        noise({ f0: 900, f1: 350, q: 0.7, dur: 0.09, gain: 0.07 });
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
      tone({ f0: 140, f1: 55, dur: 0.26, type: 'triangle', gain: 0.3 });
      noise({ f0: 700, f1: 160, q: 0.6, dur: 0.2, gain: 0.12 });
    },

    boss() {
      if (muted || !live()) return;
      tone({ f0: 55, f1: 220, dur: 0.9, type: 'triangle', gain: 0.24 });
      noise({ f0: 200, f1: 1000, q: 0.5, dur: 0.9, gain: 0.07 });
    },

    gameOver() {
      if (muted || !live()) return;
      tone({ f0: 330, f1: 70, dur: 1.1, type: 'triangle', gain: 0.25 });
    },

    // Derives shots, hits, pickups, level-ups, damage and game over from state changes since the last call.
    // A different game object (restart) resets the baselines instead of firing sounds.
    observe(game: Game) {
      const { player } = game;
      // The sim's GameFx hook type has no counter; the render fx object this is called with does (hits).
      const fx = game.fx as (Game['fx'] & { hits: number }) | undefined;
      const hits = fx ? fx.hits : 0;
      if (seen !== game || prev === null) {
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
