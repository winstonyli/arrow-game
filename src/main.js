import { createInput } from './input/input.js';
import { createGame, tick, VIEW, CAPACITY } from './game/game.js';
import { createStepper, startLoop } from './core/loop.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createWebGLRenderer } from './render/webgl.js';
import { createFx } from './render/fx.js';
import { createSfx } from './audio/sfx.js';
import { createUi } from './ui/ui.js';
import { hudModel, overModel, resultOf, bestLine } from './ui/model.js';
import { loadBest, submit } from './game/records.js';
import { createStress } from './modes/stress.js';
import { ENEMY } from './game/enemies.js';
import { createSession } from './replay/session.js';
import { createStore } from './replay/store.js';
import { randomSeed, customSeed } from './replay/seeds.js';

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
let screen = 'title'; // title | play | pause | over | none (stress: no UI, the sim always runs)
let session = null; // non-stress runs: quantizes input, ticks, records (replay.js); null in stress mode
let seed = 0;
let challenge = null; // { seed, label } for a seeded run, null for a random one
let lastReplay = null; // the run that just ended (kept for Watch replay / Copy code)
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
      if (e.code === 'KeyM' && !e.repeat) sfx.toggleMute();
    });
  } catch (e) {
    console.warn('Audio unavailable:', e.message);
  }
}

function newGame({ seed: s, label } = {}) {
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
  screen = next;
  ui.show(next);
}
function play(k, opts) {
  kind = k;
  challenge = opts ?? null;
  newGame(challenge ?? {});
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
function quit() {
  challenge = null;
  newGame();
  setScreen('title');
  refreshBests();
}
function finish() {
  const rec = direct ? null : submit(storage, kind, resultOf(game, kind));
  lastReplay = session ? session.finish() : null;
  if (lastReplay && !direct) store.submit(lastReplay, challenge?.label ?? '');
  ui.showOver(overModel(game, kind, rec));
  setScreen('over');
}

const ui = createUi(document.getElementById('ui'), {
  onPlay: play,
  onResume: resume,
  onQuit: quit,
  onAgain: () => play(kind, challenge ?? undefined),
  onPause: pause,
  onPick: (id) => session?.pick(id),
  onToggleSound: () => (sfx ? sfx.toggleMute() : false),
});

addEventListener('keydown', (e) => {
  if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyP')) return;
  if (screen === 'play') pause();
  else if (screen === 'pause') resume();
});
if (!direct) {
  addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => document.hidden && pause());
}

function syncUI() {
  if (screen === 'play' && game.over) finish();
  if (game.offer !== shownOffer) {
    shownOffer = game.offer;
    ui.setOffer(game.offer, kind === 'rooms' ? 'Room cleared' : `Level ${game.level}`);
  }
  if (screen === 'play' || screen === 'pause') ui.update(hudModel(game, kind), sfx?.muted);
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
  get seed() { return seed; },
  frameStats,
  renderer: render.kind,
};

startLoop(
  createStepper(),
  (dt) => {
    const t0 = performance.now();
    if (screen === 'play' || screen === 'none') session ? session.step(input.x, input.y) : tick(game, dt);
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
    if (game.fx) {
      game.fx.observe(game);
      game.fx.update((screen === 'play' || screen === 'none') && !game.offer && !game.over ? frameDt : 0); // freeze effects while paused
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
