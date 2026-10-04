import { KIND } from '../core/world.js';
import { clock, xpFor } from '../modes/arena.js';

export const BOSS_BANNER_S = 2.5;

// Everything the DOM layer shows, as plain values, so it can be tested without a DOM.
export function hudModel(game, kind) {
  const p = game.player;
  const m = {
    kind,
    hpPct: (Math.max(0, p.hp) / p.maxHp) * 100,
    hp: Math.max(0, Math.ceil(p.hp)),
    kills: game.kills,
    skills: Object.entries(game.skills).map(([id, count]) => ({ id, count })),
    boss: game.time - game.bossAt < BOSS_BANNER_S,
  };
  if (kind === 'rooms') {
    m.room = game.mode.room;
    m.bossRoom = game.mode.room % game.mode.bossEvery === 0;
    m.enemies = game.world.kindCount[KIND.ENEMY];
  } else {
    m.level = game.level;
    m.xpPct = (game.xp / xpFor(game.level)) * 100;
    m.time = clock(game.time);
  }
  if (game.ghost) m.ghost = ghostLine(game, kind);
  return m;
}

export const resultOf = (game, kind) => (kind === 'rooms' ? { room: game.mode.room } : { time: game.time, kills: game.kills });

// rec: the return value of records.submit, or null (stress mode: nothing recorded).
export function overModel(game, kind, rec) {
  const rows =
    kind === 'rooms'
      ? [['Room reached', String(game.mode.room)], ['Kills', String(game.kills)]]
      : [['Survived', clock(game.time)], ['Level', String(game.level)], ['Kills', String(game.kills)]];
  const newBest = [];
  if (rec) {
    if (kind === 'rooms') {
      rows.push(['Best room', String(rec.best.room)]);
      if (rec.isNew.room) newBest.push('New best room');
    } else {
      rows.push(['Best time', clock(rec.best.time)]);
      if (rec.isNew.time) newBest.push('New best time');
      if (rec.isNew.kills) newBest.push('New best kills');
    }
  }
  return { title: 'Game over', rows, newBest };
}

export function bestLine(kind, best) {
  if (kind === 'rooms') return best.room ? `Best room ${best.room}` : 'No runs yet';
  return best.time ? `Best ${clock(best.time)} / ${best.kills ?? 0} kills` : 'No runs yet';
}

const signed = (n) => (n >= 0 ? `+${n}` : String(n));

// "Ghost" is the stored best run racing alongside; `ahead` is true when the player is level with or past it.
function ghostLine(game, kind) {
  const g = game.ghost;
  const out = g.alive ? '' : '(out) ';
  if (kind === 'rooms') {
    const d = game.mode.room - g.room;
    return { text: `Ghost ${out}room ${g.room} (${signed(d)})`, ahead: d >= 0 };
  }
  const d = game.kills - g.kills;
  return { text: `Ghost ${out}Lv ${g.level} · ${g.kills} kills (${signed(d)})`, ahead: d >= 0 };
}

// Rows for the Challenges list: entries come from store.list().
export const challengeRows = (entries) =>
  entries.map((e) => ({
    mode: e.mode,
    seed: e.seed,
    title: `${e.mode === 'rooms' ? 'Rooms' : 'Arena'} · ${e.label || `Seed ${e.seed}`}`,
    line: e.mode === 'rooms' ? `Room ${e.room} · ${e.kills} kills` : `${clock(e.time)} · ${e.kills} kills`,
    stale: e.stale,
  }));

const IMPORT_ERRORS = {
  'bad-code': 'That is not a replay code',
  version: 'Replay is from a different game version',
  corrupt: 'Replay code is damaged',
  'too-large': 'Replay code is too large',
  unsupported: 'This browser cannot read that code',
  invalid: 'Replay data is invalid',
  mismatch: 'Replay does not reproduce on this version',
  engine: 'Recorded on another browser engine; it does not reproduce here',
};
// Label for an imported replay that is stored: it keeps the label of the entry it replaces (e.g. "Daily ...").
export const importLabel = (prev) => prev?.label || 'Imported';
// Label for a race against a stored entry: "Imported" names where that run came from, not your new run.
export const raceLabel = (entry) => (!entry || entry.label === 'Imported' ? '' : entry.label);
// Pasted share codes often arrive wrapped or indented (chat apps, email): a code never contains whitespace, so drop it all.
export const pastedCode = (text) => String(text ?? '').replace(/\s+/g, '');
export const importError = (code) => IMPORT_ERRORS[code] ?? 'Could not import that code';
