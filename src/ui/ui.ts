import { icon } from './icons.ts';
import { SKILLS_BY_ID } from '../game/skills.ts';

const h = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.innerHTML = html;
  return e;
};
const button = (label, cls, fn) => {
  const b = h('button', `btn ${cls}`.trim(), label);
  b.type = 'button';
  b.onclick = fn;
  return b;
};
// Only touch the DOM when a value changed: the HUD updates every frame but most values don't.
const setText = (el, v) => {
  if (el._v !== v) {
    el._v = v;
    el.textContent = v;
  }
};
const setWidth = (el, pct) => {
  const w = `${Math.round(Math.min(100, Math.max(0, pct)) * 2) / 2}%`;
  if (el._v !== w) {
    el._v = w;
    el.style.width = w;
  }
};
// Clipboard with a prompt fallback (insecure origins and some browsers have no async clipboard).
async function copyText(text) {
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
const codeButton = (label, cls, getCode, onError) => {
  let timer = 0;
  const flash = (text) => {
    b.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => (b.textContent = label), 1500);
  };
  const b = button(label, cls, async () => {
    let code;
    try {
      code = await getCode();
    } catch (e) {
      const msg = e?.code === 'too-large' || e?.code === 'invalid' ? 'Too long to share' : 'Could not make a code';
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

export function createUi(root, on) {
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
  const q = (s) => hud.querySelector(s);
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
  pausePanel.querySelector('h2').style.color = 'var(--g)';
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
  const row = (...kids) => {
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

  function setChallenges(rows) {
    list.replaceChildren(
      ...(rows.length
        ? rows.map((r) => {
            const e = h('div', `entry${r.stale ? ' stale' : ''}`);
            const info = h('div', 'info');
            info.append(h('b'), h('span'));
            info.firstChild.textContent = r.title;
            info.lastChild.textContent = r.stale ? `${r.line} · old version` : r.line;
            e.append(info);
            if (!r.stale) {
              e.append(button('Watch', 'g', () => on.onWatchEntry(r.mode, r.seed)), button('Race', '', () => on.onRace(r.mode, r.seed)), codeButton('Copy', 'b', () => on.onCopyEntry(r.mode, r.seed), setStatus));
            }
            e.append(
              button('✕', '', () => {
                // The list is rebuilt: keep focus at the same position (the next row), else on Back.
                const i = [...list.children].indexOf(e);
                on.onDelete(r.mode, r.seed);
                (list.children[i]?.querySelector('button') ?? backBtn).focus({ preventScroll: true });
              }),
            );
            e.lastChild.setAttribute('aria-label', 'Delete');
            return e;
          })
        : [h('div', 'mu', 'No runs yet. Finish a run and it shows up here.')]),
    );
  }
  const setStatus = (t) => setText(status, t);
  const setImportBusy = (busy) => (importBtn.disabled = busy);

  const picker = h('div', 'overlay picker');
  const pickHead = h('h2', 'glow-text');
  const cards = h('div', 'cards');
  picker.append(pickHead, cards, h('div', 'tip', 'Press 1, 2 or 3, or click'));
  let offer = null;

  // The watch bar is a sibling of the HUD, because the HUD is inert outside play.
  const watchbar = h('div', 'watchbar panel');
  const watchStatus = h('span', 'mu');
  const watchNote = h('span', '');
  const speedBtn = button('', 'g', () => setWatch({ ...watchState, speed: on.onWatchSpeed() }));
  let watchState = { speed: 1, done: false, note: '' };
  watchbar.append(watchStatus, speedBtn, button('Exit', 'b', () => on.onQuit()), watchNote);
  function setWatch(s) {
    watchState = s;
    setText(watchStatus, s.done ? 'Replay finished' : 'Replay');
    setText(speedBtn, `Speed ${s.speed}x`);
    setText(watchNote, s.note);
  }
  setWatch(watchState);

  root.append(hud, title, pause, over, challenges, picker, watchbar);

  // State ----------------------------------------------------------------
  let screen = 'none';
  const focusFirst = (node) => node.querySelector('button')?.focus({ preventScroll: true });

  function show(name) {
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
    else document.activeElement?.blur();
  }

  function setOffer(ids, header = '') {
    offer = ids;
    picker.hidden = !ids;
    hud.inert = screen !== 'play' || !!ids;
    if (!ids) {
      document.activeElement?.blur();
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
    cards.firstChild.focus({ preventScroll: true });
  }

  // 1-3 pick; arrows move between cards (Enter/Space activate the focused card natively).
  addEventListener('keydown', (e) => {
    if (!offer || e.repeat) return;
    const n = Number(e.key);
    if (n >= 1 && n <= offer.length) {
      e.preventDefault();
      on.onPick(offer[n - 1]);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const list = [...cards.children];
      const i = list.indexOf(document.activeElement);
      list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]?.focus();
    }
  });

  function update(m, muted) {
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

  function showOver(m) {
    overPanel.replaceChildren(
      h('h2', 'over-title glow-text', m.title),
      ...m.rows.map(([k, v]) => {
        const row = h('div', 'stat');
        row.append(h('span', '', k), h('span', ''));
        row.lastChild.textContent = v;
        return row;
      }),
      ...m.newBest.map((s) => h('div', 'new-best glow-text', s)),
      button('Play again', 'primary', () => on.onAgain()),
      ...(m.canReplay ? [button('Watch replay', 'g', () => on.onWatchLast()), codeButton('Copy code', '', () => on.onCopyLast())] : []),
      button('Title', 'b', () => on.onQuit()),
    );
  }

  function setBests(b) {
    bests.arena.textContent = `Arena: ${b.arena}`;
    bests.rooms.textContent = `Rooms: ${b.rooms}`;
  }

  return { show, update, setOffer, showOver, setBests, setWatch, setChallenges, setStatus, setImportBusy };
}
