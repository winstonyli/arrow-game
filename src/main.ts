import { createInput } from './input/input.ts';
import { createGame, tick, VIEW, CAPACITY } from './game/game.ts';
import { createStepper, startLoop } from './core/loop.ts';
import { easeCamera } from './core/camera.ts';
import { createCanvasRenderer } from './render/canvas.ts';
import { createWebGLRenderer } from './render/webgl.ts';
import { createFx } from './render/fx.ts';
import { createSfx } from './audio/sfx.ts';
import { createUi } from './ui/ui.ts';
import { hudModel, overModel, resultOf, bestLine, challengeRows, importError, pastedCode, importLabel, raceLabel } from './ui/model.ts';
import { loadBest, submit } from './game/records.ts';
import { createStress } from './modes/stress.ts';
import { ENEMY } from './game/enemies.ts';
import { offerTag } from './game/skills.ts';
import { createSession } from './replay/session.ts';
import { createStore, better } from './replay/store.ts';
import { randomSeed, customSeed, dailySeed, dailyLabel } from './replay/seeds.ts';
import { createPlayback, verify } from './replay/playback.ts';
import { toCode, fromCode, ReplayError } from './replay/codec.ts';
import { createGhostBuilder, ghostAt } from './replay/ghost.ts';
import { engineTag } from './replay/recorder.ts';
import { SIM_VERSION, TICK_HZ } from './replay/version.ts';
import type { Mode, ModeName } from './game/game.ts';
import type { Renderer, RenderGame } from './render/canvas.ts';
import type { Fx } from './render/fx.ts';
import type { Screen } from './ui/ui.ts';
import type { Replay } from './replay/codec.ts';
import type { GhostState } from './replay/ghost.ts';

/** The renderer plus the name main tags it with (makeRenderer always sets it; read by window.arrowGame). */
export type TaggedRenderer = Renderer & { kind?: 'webgl' | 'canvas2d' };
/** A non-stress live run: the session that quantizes, ticks and records. */
export type LiveSession = ReturnType<typeof createSession<Fx>>;
/** A replay being watched; `from: 'challenges'` returns there when it is left. */
export interface WatchSession {
  pb: ReturnType<typeof createPlayback<Fx>>;
  speed: number;
  done: boolean;
  note: string;
  from: string;
}
/** A seeded run: its seed and the label that names its stored replay. */
interface Challenge {
  seed: number;
  label: string;
}

const input = createInput();

let game: RenderGame;
let shownOffer: string[] | null | undefined = null;
let simMs = 0;
let drawMs = 0;
let frameMs = 0;
const frames = new Float32Array(600); // ring of recent rAF intervals
let frameCount = 0;
let lastFrame = 0;

// ?stress=N[&scenario=converge]: N total entities, half enemies and half projectiles (see modes/stress.ts).
const params = new URLSearchParams(location.search);

// ?renderer=canvas2d forces the fallback; otherwise WebGL2 when available.
function makeRenderer(): TaggedRenderer {
  const canvas = document.getElementById('game') as HTMLCanvasElement; // DOM lookup: index.html's <canvas id="game">
  if (params.get('renderer') !== 'canvas2d') {
    try {
      const r: ReturnType<typeof createWebGLRenderer> & TaggedRenderer = createWebGLRenderer(
        canvas,
        document.getElementById('hud') as HTMLCanvasElement, // DOM lookup: index.html's <canvas id="hud">
        document.getElementById('bg') as HTMLCanvasElement, // DOM lookup: index.html's <canvas id="bg">
        VIEW,
      );
      console.info('renderer: webgl2 on', r.adapter);
      r.kind = 'webgl';
      return r;
    } catch (e) {
      console.warn('WebGL renderer unavailable, using Canvas2D:', e instanceof Error ? e.message : String(e));
    }
  }
  const r: TaggedRenderer = createCanvasRenderer(canvas, VIEW);
  r.kind = 'canvas2d';
  return r;
}
const render = makeRenderer();
const stressN = Number(params.get('stress')) || 0;
const debug = params.has('debug');
const direct = !!stressN || params.has('mode'); // benchmarks and verify scripts: no title, no auto-pause
let kind: ModeName = params.get('mode') === 'arena' ? 'arena' : 'rooms';
let screen: Screen = 'title'; // title | play | pause | over | watch | challenges | none (stress: no UI, the sim always runs)
let session: LiveSession | null = null; // non-stress runs: quantizes input, ticks, records (replay.js); null in stress mode
let seed = 0;
let challenge: Challenge | null = null; // { seed, label } for a seeded run, null for a random one
let lastReplay: Replay | null = null; // the run that just ended (kept for Watch replay / Copy code until the next run starts)
let watch: WatchSession | null = null; // { pb, speed, done, note, from } while a replay is being watched; from: 'challenges' returns there
let importToken = 0; // bumped per import and whenever Challenges is left: a stale import must not open a watch
let ghostBuild: ReturnType<typeof createGhostBuilder> | null = null; // a seeded run races the stored best for its (mode, seed): builds its track a slice per frame
// ghostAt overwrites every field before it returns this object, so these zeros are never observed (was `{}`).
const ghostOut: GhostState = { x: 0, y: 0, alive: false, fade: 0, level: 0, kills: 0, room: 0 };
const storage: Storage | null = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
const store = createStore(storage);
const makeStress = () =>
  createStress({ enemies: stressN / 2, projectiles: stressN / 2, enemyType: params.get('scenario') === 'converge' ? ENEMY.CHASER : ENEMY.DUMMY });

function frameStats() {
  const s = Float32Array.from(frames.subarray(0, Math.min(frameCount, frames.length))).sort();
  return { n: s.length, medianMs: s[s.length >> 1], p95Ms: s[Math.floor(s.length * 0.95)], simMs, drawMs };
}

// Sound: one context for the page, started on the first key press or touch (browser autoplay rules). M mutes.
// No sound in stress mode or where AudioContext is missing.
let sfx: ReturnType<typeof createSfx> | undefined;
if (!stressN) {
  try {
    sfx = createSfx(new AudioContext(), storage);
    // `sfx!` in these listeners: assigned just above and never reassigned (they are only added if it was)
    const unlock = () => sfx!.resume();
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) sfx!.toggleMute(); // not while typing a seed or code
    });
  } catch (e) {
    console.warn('Audio unavailable:', e instanceof Error ? e.message : String(e));
  }
}

const drawCam = { x: 0, y: 0 }; // the eased camera the renderers draw with; the sim camera (game.camera) stays exact
function newGame({ seed: s }: { seed?: number } = {}) {
  seed = s ?? randomSeed();
  if (stressN) {
    session = null;
    game = createGame<Mode, Fx>({ mode: makeStress(), input, fx: undefined, sfx });
  } else {
    session = createSession({ mode: kind, seed, fx: createFx(CAPACITY), sfx });
    game = session.game;
  }
  shownOffer = undefined;
  drawCam.x = game.camera.x;
  drawCam.y = game.camera.y;
}

function setScreen(next: Screen) {
  if (next !== 'challenges') {
    importToken++; // an import still checking was abandoned
    ui.setImportBusy(false);
  }
  screen = next;
  ui.show(next);
}
function play(k: ModeName, opts?: Challenge) {
  kind = k;
  challenge = opts ?? null; // its label names the stored run (finish)
  lastReplay = null;
  newGame(challenge ?? {});
  ghostBuild = null;
  const best = challenge ? store.get(kind, seed) : null; // a seeded run races your stored best
  if (best) ghostBuild = createGhostBuilder(best);
  setScreen('play');
}
function pause() {
  if (screen === 'play' && !game.offer && !game.over) setScreen('pause');
}
function resume() {
  if (screen === 'pause') setScreen('play');
}
function refreshBests() {
  ui.setBests({ arena: bestLine('arena', loadBest(storage, 'arena')), rooms: bestLine('rooms', loadBest(storage, 'rooms')) });
}
function quit(to = 'title') {
  challenge = null;
  watch = null;
  ghostBuild = null;
  newGame();
  if (to === 'challenges') openChallenges();
  else setScreen('title');
  refreshBests();
}
const leaveWatch = () => quit(watch?.from);
function finish() {
  const rec = direct ? null : submit(storage, kind, resultOf(game, kind));
  lastReplay = session ? session.finish() : null;
  if (lastReplay && !direct) store.submit(lastReplay, challenge?.label ?? '');
  ui.showOver({ ...overModel(game, kind, rec), canReplay: !!lastReplay });
  setScreen('over');
}
function refreshChallenges() {
  ui.setChallenges(challengeRows(store.list()));
  ui.setStatus('');
}
function openChallenges() {
  refreshChallenges();
  setScreen('challenges');
}
async function importCode(text: string) {
  const t = ++importToken;
  const live = () => t === importToken && screen === 'challenges'; // false once Challenges was left or another import began
  ui.setImportBusy(true);
  try {
    const replay = await fromCode(pastedCode(text));
    if (!live()) return;
    if (replay.sim !== SIM_VERSION) throw new ReplayError('version');
    ui.setStatus('Checking replay...');
    await new Promise((r) => setTimeout(r)); // let the status paint before the blocking re-simulation
    if (!live()) return;
    if (!verify(replay)) throw new ReplayError(replay.engine !== engineTag() ? 'engine' : 'mismatch');
    const prev = store.list().find((e) => e.mode === replay.mode && e.seed === replay.seed);
    let note = '';
    if (!store.submit({ ...replay, savedAt: Date.now() }, importLabel(prev)).saved) {
      note = prev && !prev.stale && !better(replay.mode, replay.result, prev) ? 'Not saved: your stored run is better' : 'Not saved: storage is unavailable';
    }
    startWatch(replay, { from: 'challenges', note });
  } catch (e) {
    if (live()) ui.setStatus(importError(e instanceof ReplayError ? e.code : undefined)); // other errors carry no import code: the generic message
  } finally {
    if (t === importToken) ui.setImportBusy(false);
  }
}
function setWatchUi(note = '') {
  ui.setWatch({ speed: watch!.speed, done: watch!.done, note }); // `!`: only called while a replay is being watched
}
function startWatch(replay: Replay | null, { from = '', note = '' }: { from?: string; note?: string } = {}) {
  if (!replay || replay.sim !== SIM_VERSION) return;
  kind = replay.mode;
  challenge = null;
  session = null;
  const pb = createPlayback(replay, { fx: createFx(CAPACITY), sfx });
  game = pb.game;
  shownOffer = undefined;
  const drift = replay.engine !== engineTag() ? 'Recorded on another browser engine: may drift' : '';
  watch = { pb, speed: 1, done: false, note: [note, drift].filter(Boolean).join(' · '), from };
  setWatchUi(watch.note);
  setScreen('watch');
}
// `watch!` below: only stepped while screen === 'watch', which startWatch enters after setting `watch`.
function stepWatch() {
  if (watch!.done) return;
  try {
    for (let i = 0; i < watch!.speed; i++) {
      if (!watch!.pb.step()) {
        watch!.done = true;
        break;
      }
    }
  } catch (e) {
    if (!(e instanceof ReplayError)) throw e;
    watch!.done = true;
    watch!.note = 'Replay went out of sync';
  }
  if (watch!.done) setWatchUi(watch!.note);
}

const ui = createUi(document.getElementById('ui')!, { // `!`: DOM lookup, index.html's <div id="ui">
  onPlay: play,
  onResume: resume,
  onQuit: () => (screen === 'watch' ? leaveWatch() : quit()),
  onAgain: () => play(kind, challenge ?? undefined),
  onPause: pause,
  onPick: (id) => session?.pick(id),
  onToggleSound: () => (sfx ? sfx.toggleMute() : false),
  onWatchLast: () => startWatch(lastReplay),
  onCopyLast: () => (lastReplay ? toCode(lastReplay) : null),
  onWatchSpeed: () => {
    // `!`: the speed button is only on the watch screen, which exists only while `watch` is set
    watch!.speed = watch!.speed === 1 ? 4 : 1;
    return watch!.speed;
  },
  onChallenges: openChallenges,
  onBack: () => setScreen('title'),
  onDaily: (mode) => {
    const d = new Date(); // one clock read: the seed and the label always name the same day
    play(mode, { seed: dailySeed(mode, d), label: dailyLabel(d) });
  },
  onSeed: (mode, text) => {
    const s = customSeed(text);
    if (s === null) ui.setStatus('Enter a seed first');
    else play(mode, { seed: s, label: text.trim() });
  },
  onWatchEntry: (mode, s) => {
    const r = store.get(mode, s);
    if (r) startWatch(r, { from: 'challenges' });
    else ui.setStatus('That replay is not available');
  },
  onRace: (mode, s) => play(mode, { seed: s, label: raceLabel(store.list().find((e) => e.mode === mode && e.seed === s)) }),
  onCopyEntry: async (mode, s) => {
    const r = store.get(mode, s);
    return r ? toCode(r) : null;
  },
  onDelete: (mode, s) => {
    store.remove(mode, s);
    refreshChallenges();
  },
  onImport: importCode,
});

addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
  if (screen === 'play') pause();
  else if (screen === 'pause') resume();
  else if (screen === 'watch' && e.code === 'Escape') leaveWatch();
  else if (screen === 'challenges' && e.code === 'Escape') setScreen('title');
});
if (!direct) {
  addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => document.hidden && pause());
}

function syncUI() {
  if (screen === 'play' && game.over) finish();
  const offer = screen === 'watch' ? null : game.offer; // the viewer never shows the picker
  if (offer !== shownOffer) {
    shownOffer = offer;
    ui.setOffer(offer, kind === 'rooms' ? 'Room cleared' : `Level ${game.level}`, offer ? offer.map((id) => offerTag(game.player.stats, id)) : []);
  }
  if (screen === 'play' || screen === 'pause' || screen === 'watch') ui.update(hudModel(game, kind), sfx?.muted);
}

const urlSeed = params.has('seed') ? customSeed(params.get('seed')!) : null; // ?mode=arena&seed=123 for reproducible direct runs; `!`: has('seed') was just checked
newGame(urlSeed === null ? {} : { seed: urlSeed });
refreshBests();
setScreen(stressN ? 'none' : direct ? 'play' : 'title');
window.arrowGame = {
  get game() { return game; },
  get screen() { return screen; },
  get mode() { return kind; },
  get session() { return session; },
  get lastReplay() { return lastReplay; },
  get watch() { return watch; },
  get seed() { return seed; },
  frameStats,
  renderer: render.kind,
};

startLoop(
  createStepper(TICK_HZ),
  (dt) => {
    const t0 = performance.now();
    if (screen === 'watch') stepWatch();
    else if (screen === 'play' || screen === 'none') session ? session.step(input.x, input.y) : tick(game, dt);
    simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
  },
  () => {
    const t0 = performance.now();
    if (lastFrame) {
      frameMs = frameMs * 0.9 + (t0 - lastFrame) * 0.1;
      frames[frameCount++ % frames.length] = t0 - lastFrame;
    }
    const frameDt = lastFrame ? Math.min(0.05, (t0 - lastFrame) / 1000) : 0;
    lastFrame = t0;
    syncUI();
    if (ghostBuild && screen === 'play') {
      try {
        ghostBuild.work(6);
        game.ghost = ghostAt(ghostBuild.track, game.ticks, ghostOut);
      } catch (e) {
        console.warn('ghost unavailable:', e instanceof Error ? e.message : String(e));
        ghostBuild = null;
        game.ghost = null;
      }
    }
    if (game.fx) {
      game.fx.observe(game);
      game.fx.update((screen === 'play' || screen === 'none' || screen === 'watch') && !game.offer && !game.over ? frameDt : 0); // freeze effects while paused
    }
    sfx?.observe(game);
    easeCamera(drawCam, game.camera, frameDt);
    render(
      game,
      debug
        ? [
            `${game.mode.hud?.(game) ?? ''}  HP ${Math.max(0, Math.ceil(game.player.hp))}  Kills ${game.kills}`,
            `entities ${game.world.count}  dropped ${game.world.dropped}  sim ${simMs.toFixed(2)} ms  draw ${drawMs.toFixed(2)} ms  frame ${frameMs.toFixed(1)} ms`,
          ]
        : [],
    drawCam,
    );
    drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1;
  },
);
