import { createInput } from './input/input.js';
import { createRooms } from './modes/rooms.js';
import { createGame, tick, choose, BOUNDS } from './game/game.js';
import { createStepper, startLoop } from './core/loop.js';
import { createCanvasRenderer } from './render/canvas.js';
import { SKILLS_BY_ID } from './game/skills.js';

const picker = document.getElementById('picker');
const over = document.getElementById('over');
const overText = document.getElementById('over-text');
const input = createInput();
const render = createCanvasRenderer(document.getElementById('game'), BOUNDS);

let game;
let shownOffer = null;
let simMs = 0;

function newGame() {
  game = createGame({ mode: createRooms(), input });
  shownOffer = null;
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
  if (game.over) overText.textContent = `Game over: reached room ${game.mode.room}, ${game.kills} kills`;
}

newGame();
window.arrowGame = { get game() { return game; } };

startLoop(
  createStepper(),
  (dt) => {
    const t0 = performance.now();
    tick(game, dt);
    simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
  },
  () => {
    syncUI();
    render(game, [
      `Room ${game.mode.room}  HP ${Math.max(0, Math.ceil(game.player.hp))}  Kills ${game.kills}`,
      `entities ${game.world.count}  dropped ${game.world.dropped}  sim ${simMs.toFixed(2)} ms`,
    ]);
  },
);
