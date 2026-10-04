import { icon } from './icons.ts';
import { SKILLS_BY_ID } from '../game/skills.ts';
import { ReplayError } from '../replay/codec.ts';
import type { ModeName } from '../game/game.ts';
import type { HudModel, OverModel, ChallengeRow } from './model.ts';

export type Screen = 'none' | 'title' | 'play' | 'pause' | 'over' | 'challenges' | 'watch';
export interface WatchState {
  speed: number;
  done: boolean;
  note: string;
}
export interface UiHandlers {
  onPlay: (mode: ModeName) => void;
  onResume: () => void;
  onQuit: () => void;
  onAgain: () => void;
  onPause: () => void;
  onPick: (id: string) => void;
  onToggleSound: () => void;
  onWatchLast: () => void;
  onCopyLast: () => CodeSource;
  onWatchSpeed: () => number;
  onChallenges: () => void;
  onBack: () => void;
  onDaily: (mode: ModeName) => void;
  onSeed: (mode: ModeName, text: string) => void;
  onWatchEntry: (mode: ModeName, seed: number) => void;
  onRace: (mode: ModeName, seed: number) => void;
  onCopyEntry: (mode: ModeName, seed: number) => CodeSource;
  onDelete: (mode: ModeName, seed: number) => void;
  onImport: (text: string) => void;
}
/** A share code, or null when there is nothing to copy (awaited, so a promise of either works too). */
type CodeSource = string | null | Promise<string | null>;
// Elements carry their last written value as expandos so per-frame updates skip unchanged DOM writes.
type Cached = HTMLElement & { _v?: string };
type HudSlot = Cached & { _k?: string; _on?: boolean };

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = html;
  return e;
};
const button = (label: string, cls: string, fn: () => void) => {
  const b = h('button', `btn ${cls}`.trim(), label);
  b.type = 'button';
  b.onclick = fn;
  return b;
};
// A required element inside markup this module just built: missing means the template is broken.
function lookup<T extends Element>(root: ParentNode, selector: string): T {
  const e = root.querySelector(selector);
  if (!e) throw new Error(`ui: missing element ${selector}`);
  return e as T; // DOM boundary: querySelector cannot know the element type a selector names
}
// Only touch the DOM when a value changed: the HUD updates every frame but most values don't.
const setText = (el: Cached, v: string) => {
  if (el._v !== v) {
    el._v = v;
    el.textContent = v;
  }
};
const setWidth = (el: Cached, pct: number) => {
  const w = `${Math.round(Math.min(100, Math.max(0, pct)) * 2) / 2}%`;
  if (el._v !== w) {
    el._v = w;
    el.style.width = w;
  }
};
// Clipboard with a prompt fallback (insecure origins and some browsers have no async clipboard).
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy this replay code:', text);
    return false;
  }
}
// A button that fetches a share code on click and copies it; flashes "Copied". If the code cannot be made,
// `onError(message)` reports it (default: the button flashes the message).
const codeButton = (label: string, cls: string, getCode: () => CodeSource, onError?: (msg: string) => void) => {
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const flash = (text: string) => {
    b.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => (b.textContent = label), 1500);
  };
  const b = button(label, cls, async () => {
    let code: string | null;
    try {
      code = await getCode();
    } catch (e) {
      // getCode is main.ts's toCode on the last or stored replay (or null). toCode throws ReplayError 'too-large' past the
      // code size limits, or validate's codes ('invalid' covers its length caps, e.g. MAX_TICKS; also 'version').
      // 'too-large' and 'invalid' read as too long to share; anything else gets the generic message.
      const msg = e instanceof ReplayError && (e.code === 'too-large' || e.code === 'invalid') ? 'Too long to share' : 'Could not make a code';
      if (onError) onError(msg);
      else flash(msg);
      return;
    }
    if (!code) return;
    const ok = await copyText(code);
    flash(ok ? 'Copied' : label);
  });
  return b;
};

export function createUi(root: ParentNode, on: UiHandlers) {
  // HUD ------------------------------------------------------------------
  const hud = h('div', 'hud');
  hud.innerHTML = `
    <div class="hud-top panel">
      <span class="ic">${icon('heart')}</span><div class="bar hp"><i></i></div><b class="hp-n"></b>
      <span class="arena-only"><span class="mu">Lv</span> <b class="lv"></b></span><div class="bar xp arena-only"><i></i></div>
      <span class="rooms-only"><span class="mu">Room</span> <b class="room"></b> <b class="boss-room" style="color:var(--x)"></b></span>
      <span class="spacer"></span>
      <b class="time arena-only"></b>
      <span class="mu">${icon('skull')} <b class="kills" style="color:var(--text)"></b></span>
      <button class="pause-btn" type="button" aria-label="Pause">${icon('pause')}</button>
    </div>
    <div class="foes rooms-only">Enemies left <b class="foes-n"></b></div>
    <div class="ghost-line" hidden></div>
    <div class="skills"></div>
    <div class="sound-hint">[M] sound <span class="snd"></span></div>
    <div class="banner"><b class="glow-text">Warning</b><span>Something big is coming</span></div>`;
  const q = (s: string) => lookup<HudSlot>(hud, s);
  const el = {
    hp: q('.bar.hp i'), hpN: q('.hp-n'), lv: q('.lv'), xp: q('.bar.xp i'), room: q('.room'), bossRoom: q('.boss-room'),
    time: q('.time'), kills: q('.kills'), foes: q('.foes-n'), skills: q('.skills'), snd: q('.snd'), banner: q('.banner'),
    ghost: q('.ghost-line'),
  };
  q('.pause-btn').onclick = () => on.onPause();

  // Overlays -------------------------------------------------------------
  const title = h('div', 'overlay');
  const titlePanel = h('div', 'panel');
  const bests = { arena: h('div', 'mu'), rooms: h('div', 'mu') };
  titlePanel.append(
    h('h1', 'title-name glow-text', 'Arrow game'),
    h('div', 'mu', 'Survive. Level up. Repeat.'),
    button('Arena', 'primary b', () => on.onPlay('arena')),
    bests.arena,
    button('Rooms', '', () => on.onPlay('rooms')),
    bests.rooms,
    button('Challenges', 'g', () => on.onChallenges()),
    h('div', 'mu', 'WASD or arrows to move. Aim is automatic.'),
  );
  title.append(titlePanel);

  const pause = h('div', 'overlay');
  const soundBtn = button('', 'g', () => on.onToggleSound());
  const pausePanel = h('div', 'panel');
  pausePanel.append(
    h('h2', 'glow-text', 'Paused'),
    button('Resume', 'primary b', () => on.onResume()),
    soundBtn,
    button('Quit to title', '', () => on.onQuit()),
    h('div', 'mu', 'Esc to resume'),
  );
  lookup<HTMLElement>(pausePanel, 'h2').style.color = 'var(--g)';
  pause.append(pausePanel);

  const over = h('div', 'overlay');
  const overPanel = h('div', 'panel');
  over.append(overPanel);

  const challenges = h('div', 'overlay');
  const chPanel = h('div', 'panel wide');
  const seedField = h('input', 'field');
  seedField.type = 'text';
  seedField.maxLength = 40;
  seedField.placeholder = 'Seed (any text or number)';
  seedField.setAttribute('aria-label', 'Seed');
  const importField = h('input', 'field');
  importField.type = 'text';
  importField.placeholder = 'Paste a replay code';
  importField.setAttribute('aria-label', 'Replay code');
  const list = h('div', 'list');
  const status = h('div', 'status');
  status.setAttribute('role', 'status');
  const importBtn = button('Import', 'g', () => on.onImport(importField.value));
  const backBtn = button('Back', 'b', () => on.onBack());
  const row = (...kids: HTMLElement[]) => {
    const r = h('div', 'row');
    r.append(...kids);
    return r;
  };
  chPanel.append(
    h('h2', 'glow-text', 'Challenges'),
    row(button('Daily Arena', 'primary', () => on.onDaily('arena')), button('Daily Rooms', 'primary b', () => on.onDaily('rooms'))),
    row(seedField, button('Arena', 'g', () => on.onSeed('arena', seedField.value)), button('Rooms', 'g', () => on.onSeed('rooms', seedField.value))),
    h('div', 'mu', 'Your best runs (race them as a ghost)'),
    list,
    row(importField, importBtn),
    status,
    backBtn,
  );
  challenges.append(chPanel);

  function setChallenges(rows: ChallengeRow[]) {
    list.replaceChildren(
      ...(rows.length
        ? rows.map((r) => {
            const e = h('div', `entry${r.stale ? ' stale' : ''}`);
            const info = h('div', 'info');
            const name = h('b');
            const line = h('span');
            info.append(name, line);
            name.textContent = r.title;
            line.textContent = r.stale ? `${r.line} · old version` : r.line;
            e.append(info);
            if (!r.stale) {
              e.append(button('Watch', 'g', () => on.onWatchEntry(r.mode, r.seed)), button('Race', '', () => on.onRace(r.mode, r.seed)), codeButton('Copy', 'b', () => on.onCopyEntry(r.mode, r.seed), setStatus));
            }
            const del = button('✕', '', () => {
              // The list is rebuilt: keep focus at the same position (the next row), else on Back.
              const i = [...list.children].indexOf(e);
              on.onDelete(r.mode, r.seed);
              (list.children[i]?.querySelector('button') ?? backBtn).focus({ preventScroll: true });
            });
            e.append(del);
            del.setAttribute('aria-label', 'Delete');
            return e;
          })
        : [h('div', 'mu', 'No runs yet. Finish a run and it shows up here.')]),
    );
  }
  const setStatus = (t: string) => setText(status, t);
  const setImportBusy = (busy: boolean) => (importBtn.disabled = busy);

  const picker = h('div', 'overlay picker');
  const pickHead = h('h2', 'glow-text');
  const cards = h('div', 'cards');
  picker.append(pickHead, cards, h('div', 'tip', 'Press 1, 2 or 3, or click'));
  let offer: string[] | null = null;

  // The watch bar is a sibling of the HUD, because the HUD is inert outside play.
  const watchbar = h('div', 'watchbar panel');
  const watchStatus = h('span', 'mu');
  const watchNote = h('span', '');
  const speedBtn = button('', 'g', () => setWatch({ ...watchState, speed: on.onWatchSpeed() }));
  let watchState: WatchState = { speed: 1, done: false, note: '' };
  watchbar.append(watchStatus, speedBtn, button('Exit', 'b', () => on.onQuit()), watchNote);
  function setWatch(s: WatchState) {
    watchState = s;
    setText(watchStatus, s.done ? 'Replay finished' : 'Replay');
    setText(speedBtn, `Speed ${s.speed}x`);
    setText(watchNote, s.note);
  }
  setWatch(watchState);

  root.append(hud, title, pause, over, challenges, picker, watchbar);

  // State ----------------------------------------------------------------
  let screen: Screen = 'none';
  const focusFirst = (node: ParentNode) => node.querySelector('button')?.focus({ preventScroll: true });

  function show(name: Screen) {
    screen = name;
    hud.hidden = name === 'none' || name === 'title' || name === 'over' || name === 'challenges';
    hud.dataset.watch = String(name === 'watch');
    watchbar.hidden = name !== 'watch';
    title.hidden = name !== 'title';
    pause.hidden = name !== 'pause';
    over.hidden = name !== 'over';
    challenges.hidden = name !== 'challenges';
    // Overlays and the picker own the keyboard: take the HUD (pause button) out of the tab order.
    hud.inert = name !== 'play' || !!offer;
    if (name === 'title') focusFirst(title);
    else if (name === 'pause') {
      focusFirst(pause);
    } else if (name === 'over') focusFirst(over);
    else if (name === 'challenges') focusFirst(challenges);
    else (document.activeElement as HTMLElement | null)?.blur(); // DOM boundary: activeElement is typed Element, which has no blur
  }

  function setOffer(ids: string[] | null, header = '') {
    offer = ids;
    picker.hidden = !ids;
    hud.inert = screen !== 'play' || !!ids;
    if (!ids) {
      (document.activeElement as HTMLElement | null)?.blur(); // DOM boundary: as above
      return;
    }
    pickHead.textContent = header;
    cards.replaceChildren(
      ...ids.map((id, i) => {
        const s = SKILLS_BY_ID[id];
        const c = h('button', 'card', `<span class="key">[${i + 1}]</span>${icon(id)}<span class="name">${s.name}</span><span class="desc">${s.desc}</span>`);
        c.type = 'button';
        c.onclick = () => on.onPick(id);
        return c;
      }),
    );
    // DOM boundary: cards holds only the buttons built above (for an empty offer it is null and this throws, as it always did).
    (cards.firstChild as HTMLElement).focus({ preventScroll: true });
  }

  // 1-3 pick; arrows move between cards (Enter/Space activate the focused card natively).
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (!offer || e.repeat) return;
    const n = Number(e.key);
    if (n >= 1 && n <= offer.length) {
      e.preventDefault();
      on.onPick(offer[n - 1]);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const list = [...cards.children] as HTMLElement[]; // DOM boundary: cards holds only the buttons setOffer built
      const i = list.findIndex((c) => c === document.activeElement); // indexOf, but activeElement is typed Element | null
      list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]?.focus();
    }
  });

  function update(m: HudModel, muted: boolean | undefined) {
    hud.dataset.kind = m.kind;
    setWidth(el.hp, m.hpPct);
    setText(el.hpN, String(m.hp));
    setText(el.kills, String(m.kills));
    if (m.kind === 'rooms') {
      setText(el.room, String(m.room));
      setText(el.bossRoom, m.bossRoom ? 'Boss room' : '');
      setText(el.foes, String(m.enemies));
    } else {
      setText(el.lv, String(m.level));
      setWidth(el.xp, m.xpPct);
      setText(el.time, m.time);
    }
    const key = m.skills.map((s) => s.id + s.count).join();
    if (el.skills._k !== key) {
      el.skills._k = key;
      el.skills.innerHTML = m.skills.map((s) => `<div class="skill">${icon(s.id)} ${s.count}</div>`).join('');
    }
    if (el.banner._on !== m.boss) {
      el.banner._on = m.boss;
      el.banner.classList.toggle('on', m.boss);
    }
    el.ghost.hidden = !m.ghost;
    if (m.ghost) {
      setText(el.ghost, m.ghost.text);
      const ahead = String(m.ghost.ahead);
      if (el.ghost.dataset.ahead !== ahead) el.ghost.dataset.ahead = ahead;
    }
    setText(el.snd, muted ? 'off' : 'on');
    setText(soundBtn, `Sound: ${muted ? 'off' : 'on'}`);
  }

  function showOver(m: OverModel & { canReplay: boolean }) {
    overPanel.replaceChildren(
      h('h2', 'over-title glow-text', m.title),
      ...m.rows.map(([k, v]) => {
        const row = h('div', 'stat');
        const label = h('span', '', k);
        const value = h('span', '');
        row.append(label, value);
        value.textContent = v;
        return row;
      }),
      ...m.newBest.map((s) => h('div', 'new-best glow-text', s)),
      button('Play again', 'primary', () => on.onAgain()),
      ...(m.canReplay ? [button('Watch replay', 'g', () => on.onWatchLast()), codeButton('Copy code', '', () => on.onCopyLast())] : []),
      button('Title', 'b', () => on.onQuit()),
    );
  }

  function setBests(b: { arena: string; rooms: string }) {
    bests.arena.textContent = `Arena: ${b.arena}`;
    bests.rooms.textContent = `Rooms: ${b.rooms}`;
  }

  return { show, update, setOffer, showOver, setBests, setWatch, setChallenges, setStatus, setImportBusy };
}
