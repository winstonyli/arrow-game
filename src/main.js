import { createInput } from './input/input.js';
import { createRooms } from './modes/rooms.js';
import { createGame, tick, choose, VIEW, CAPACITY } from './game/game.js';
import { createStepper, startLoop } from './core/loop.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createWebGLRenderer } from './render/webgl.js';
import { createFx } from './render/fx.js';
import { SKILLS_BY_ID } from './game/skills.js';
import { createStress } from './modes/stress.js';
import { ENEMY } from './game/enemies.js';
import { createArena, ARENA_BOUNDS } from './modes/arena.js';

const picker = document.getElementById('picker');
const over = document.getElementById('over');
const overText = document.getElementById('over-text');
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
      const r = createWebGLRenderer(canvas, document.getElementById('hud'), VIEW);
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
const arena = params.get('mode') === 'arena' && !stressN;
const makeMode = () =>
  stressN
    ? createStress({ enemies: stressN / 2, projectiles: stressN / 2, enemyType: params.get('scenario') === 'converge' ? ENEMY.CHASER : ENEMY.DUMMY })
    : arena
      ? createArena()
      : createRooms();

function frameStats() {
  const s = Float32Array.from(frames.subarray(0, Math.min(frameCount, frames.length))).sort();
  return { n: s.length, medianMs: s[s.length >> 1], p95Ms: s[Math.floor(s.length * 0.95)], simMs, drawMs };
}

function newGame() {
  game = createGame({ mode: makeMode(), bounds: arena ? ARENA_BOUNDS : undefined, input, fx: stressN ? undefined : createFx(CAPACITY) });
  shownOffer = undefined;
}
document.getElementById('restart').onclick = newGame;

function syncUI() {
  if (game.offer !== shownOffer) {
    shownOffer = game.offer;
    picker.replaceChildren(
      ...(game.offer ?? []).map((id) => {
        const b = document.createElement('button');
        b.textContent = `${SKILLS_BY_ID[id].name}: ${SKILLS_BY_ID[id].desc}`;
        b.onclick = () => choose(game, id);
        return b;
      }),
    );
    picker.hidden = !game.offer;
  }
  over.hidden = !game.over;
  if (game.over) {
    const parts = [game.mode.summary?.(game), `${game.kills} kills`].filter(Boolean);
    overText.textContent = `Game over: ${parts.join(', ')}`;
  }
}

newGame();
window.arrowGame = { get game() { return game; }, frameStats, renderer: render.kind, mode: params.get('mode') ?? 'rooms' };

startLoop(
  createStepper(),
  (dt) => {
    const t0 = performance.now();
    tick(game, dt);
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
      game.fx.update(frameDt);
    }
    render(game, [
      `${game.mode.hud?.(game) ?? ''}  HP ${Math.max(0, Math.ceil(game.player.hp))}  Kills ${game.kills}`,
      `entities ${game.world.count}  dropped ${game.world.dropped}  sim ${simMs.toFixed(2)} ms  draw ${drawMs.toFixed(2)} ms  frame ${frameMs.toFixed(1)} ms`,
    ]);
    drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1;
  },
);
