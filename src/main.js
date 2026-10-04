import { createInput } from './input/input.js';
import { createGame, tick, VIEW, CAPACITY } from './game/game.js';
import { createStepper, startLoop } from './core/loop.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createWebGLRenderer } from './render/webgl.js';
import { createFx } from './render/fx.js';
import { createSfx } from './audio/sfx.js';
import { createUi } from './ui/ui.js';
import { hudModel, overModel, resultOf, bestLine, challengeRows, importError, pastedCode, importLabel, raceLabel } from './ui/model.js';
import { loadBest, submit } from './game/records.js';
import { createStress } from './modes/stress.js';
import { ENEMY } from './game/enemies.js';
import { createSession } from './replay/session.js';
import { createStore, better } from './replay/store.js';
import { randomSeed, customSeed, dailySeed, dailyLabel } from './replay/seeds.js';
import { createPlayback, verify } from './replay/playback.js';
import { toCode, fromCode, ReplayError } from './replay/codec.js';
import { createGhostBuilder, ghostAt } from './replay/ghost.js';
import { engineTag } from './replay/recorder.js';
import { SIM_VERSION } from './replay/version.js';

const input = createInput();

let game;
let shownOffer = null;
let simMs = 0;
let drawMs = 0;
let frameMs = 0;
const frames = new Float32Array(600); // ring of recent rAF intervals
let frameCount = 0;
let lastFrame = 0;

// ?stress=N[&scenario=converge]: N total entities, half enemies and half projectiles (see modes/stress.js).
const params = new URLSearchParams(location.search);

// ?renderer=canvas2d forces the fallback; otherwise WebGL2 when available.
function makeRenderer() {
  const canvas = document.getElementById('game');
  if (params.get('renderer') !== 'canvas2d') {
    try {
      const r = createWebGLRenderer(canvas, document.getElementById('hud'), document.getElementById('bg'), VIEW);
      console.info('renderer: webgl2 on', r.adapter);
      r.kind = 'webgl';
      return r;
    } catch (e) {
      console.warn('WebGL renderer unavailable, using Canvas2D:', e.message);
    }
  }
  const r = createCanvasRenderer(canvas, VIEW);
  r.kind = 'canvas2d';
  return r;
}
const render = makeRenderer();
const stressN = Number(params.get('stress')) || 0;
const debug = params.has('debug');
const direct = !!stressN || params.has('mode'); // benchmarks and verify scripts: no title, no auto-pause
let kind = params.get('mode') === 'arena' ? 'arena' : 'rooms';
let screen = 'title'; // title | play | pause | over | watch | challenges | none (stress: no UI, the sim always runs)
let session = null; // non-stress runs: quantizes input, ticks, records (replay.js); null in stress mode
let seed = 0;
let challenge = null; // { seed, label } for a seeded run, null for a random one
let lastReplay = null; // the run that just ended (kept for Watch replay / Copy code until the next run starts)
let watch = null; // { pb, speed, done, note, from } while a replay is being watched; from: 'challenges' returns there
let importToken = 0; // bumped per import and whenever Challenges is left: a stale import must not open a watch
let ghostBuild = null; // a seeded run races the stored best for its (mode, seed): builds its track a slice per frame
const ghostOut = {};
const storage = (() => {
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
let sfx;
if (!stressN) {
  try {
    sfx = createSfx(new AudioContext(), storage);
    const unlock = () => sfx.resume();
    addEventListener('keydown', unlock);
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) sfx.toggleMute(); // not while typing a seed or code
    });
  } catch (e) {
    console.warn('Audio unavailable:', e.message);
  }
}

function newGame({ seed: s } = {}) {
  seed = s ?? randomSeed();
  if (stressN) {
    session = null;
    game = createGame({ mode: makeStress(), input, fx: undefined, sfx });
  } else {
    session = createSession({ mode: kind, seed, fx: createFx(CAPACITY), sfx });
    game = session.game;
  }
  shownOffer = undefined;
}

function setScreen(next) {
  if (next !== 'challenges') {
    importToken++; // an import still checking was abandoned
    ui.setImportBusy(false);
  }
  screen = next;
  ui.show(next);
}
function play(k, opts) {
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
async function importCode(text) {
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
    if (!store.submit(replay, importLabel(prev)).saved) {
      note = prev && !prev.stale && !better(replay.mode, replay.result, prev) ? 'Not saved: your stored run is better' : 'Not saved: storage is unavailable';
    }
    startWatch(replay, { from: 'challenges', note });
  } catch (e) {
    if (live()) ui.setStatus(importError(e?.code));
  } finally {
    if (t === importToken) ui.setImportBusy(false);
  }
}
function setWatchUi(note = '') {
  ui.setWatch({ speed: watch.speed, done: watch.done, note });
}
function startWatch(replay, { from = '', note = '' } = {}) {
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
function stepWatch() {
  if (watch.done) return;
  try {
    for (let i = 0; i < watch.speed; i++) {
      if (!watch.pb.step()) {
        watch.done = true;
        break;
      }
    }
  } catch (e) {
    if (!(e instanceof ReplayError)) throw e;
    watch.done = true;
    watch.note = 'Replay went out of sync';
  }
  if (watch.done) setWatchUi(watch.note);
}

const ui = createUi(document.getElementById('ui'), {
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
    watch.speed = watch.speed === 1 ? 4 : 1;
    return watch.speed;
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

addEventListener('keydown', (e) => {
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
    ui.setOffer(offer, kind === 'rooms' ? 'Room cleared' : `Level ${game.level}`);
  }
  if (screen === 'play' || screen === 'pause' || screen === 'watch') ui.update(hudModel(game, kind), sfx?.muted);
}

const urlSeed = params.has('seed') ? customSeed(params.get('seed')) : null; // ?mode=arena&seed=123 for reproducible direct runs
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
  createStepper(),
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
        console.warn('ghost unavailable:', e.message);
        ghostBuild = null;
        game.ghost = null;
      }
    }
    if (game.fx) {
      game.fx.observe(game);
      game.fx.update((screen === 'play' || screen === 'none' || screen === 'watch') && !game.offer && !game.over ? frameDt : 0); // freeze effects while paused
    }
    sfx?.observe(game);
    render(
      game,
      debug
        ? [
            `${game.mode.hud?.(game) ?? ''}  HP ${Math.max(0, Math.ceil(game.player.hp))}  Kills ${game.kills}`,
            `entities ${game.world.count}  dropped ${game.world.dropped}  sim ${simMs.toFixed(2)} ms  draw ${drawMs.toFixed(2)} ms  frame ${frameMs.toFixed(1)} ms`,
          ]
        : [],
    );
    drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1;
  },
);
