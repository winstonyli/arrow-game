import { KIND } from '../core/world.ts';
import { clock, xpFor } from '../modes/arena.ts';
import type { Game, ModeName } from '../game/game.ts';
import type { Bests } from '../game/records.ts';
import type { GhostState } from '../replay/ghost.ts';
import type { ReplayEntry } from '../replay/codec.ts';

export const BOSS_BANNER_S = 2.5;

export interface GhostLine {
  text: string;
  ahead: boolean;
}
interface HudCommon {
  hpPct: number;
  hp: number;
  kills: number;
  skills: { id: string; count: number }[];
  boss: boolean;
  ghost?: GhostLine; // set only while a ghost races
}
export interface RoomsHud extends HudCommon {
  kind: 'rooms';
  room: number | undefined; // `Mode.room` is optional (arena modes have none)
  bossRoom: boolean;
  enemies: number;
}
export interface ArenaHud extends HudCommon {
  kind: 'arena';
  level: number;
  xpPct: number;
  time: string;
}
export type HudModel = RoomsHud | ArenaHud;

// Everything the DOM layer shows, as plain values, so it can be tested without a DOM.
export function hudModel(game: Game, kind: ModeName): HudModel {
  const p = game.player;
  const common = {
    hpPct: (Math.max(0, p.hp) / p.maxHp) * 100,
    hp: Math.max(0, Math.ceil(p.hp)),
    kills: game.kills,
    skills: Object.entries(game.skills).map(([id, count]) => ({ id, count })),
    boss: game.time - game.bossAt < BOSS_BANNER_S,
  };
  // `kind` first, then the common fields, then the kind's own: the same key order the model always had.
  const m: HudModel =
    kind === 'rooms'
      ? {
          kind,
          ...common,
          room: game.mode.room,
          // `?? NaN`: a mode without room/bossEvery read undefined here, and undefined arithmetic is NaN; kept as it was.
          bossRoom: (game.mode.room ?? NaN) % (game.mode.bossEvery ?? NaN) === 0,
          enemies: game.world.kindCount[KIND.ENEMY],
        }
      : {
          kind,
          ...common,
          level: game.level,
          xpPct: (game.xp / xpFor(game.level)) * 100,
          time: clock(game.time),
        };
  if (game.ghost) m.ghost = ghostLine(game, kind, game.ghost);
  return m;
}

export const resultOf = (game: Game, kind: ModeName): { room: number | undefined } | { time: number; kills: number } =>
  kind === 'rooms' ? { room: game.mode.room } : { time: game.time, kills: game.kills };

export interface OverModel {
  title: string;
  rows: [label: string, value: string][];
  newBest: string[];
}

// rec: the return value of records.submit, or null (stress mode: nothing recorded).
export function overModel(game: Game, kind: ModeName, rec: { best: Bests; isNew: Record<string, boolean> } | null): OverModel {
  const rows: [string, string][] =
    kind === 'rooms'
      ? [['Room reached', String(game.mode.room)], ['Kills', String(game.kills)]]
      : [['Survived', clock(game.time)], ['Level', String(game.level)], ['Kills', String(game.kills)]];
  const newBest: string[] = [];
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

export function bestLine(kind: ModeName, best: Bests): string {
  if (kind === 'rooms') return best.room ? `Best room ${best.room}` : 'No runs yet';
  return best.time ? `Best ${clock(best.time)} / ${best.kills ?? 0} kills` : 'No runs yet';
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

// "Ghost" is the stored best run racing alongside; `ahead` is true when the player is level with or past it.
// `g` is `game.ghost`, passed in once hudModel has checked it is set.
function ghostLine(game: Game, kind: ModeName, g: GhostState): GhostLine {
  const out = g.alive ? '' : '(out) ';
  if (kind === 'rooms') {
    const d = (game.mode.room ?? NaN) - g.room; // `?? NaN`: undefined - n was NaN; kept as it was
    return { text: `Ghost ${out}room ${g.room} (${signed(d)})`, ahead: d >= 0 };
  }
  const d = game.kills - g.kills;
  return { text: `Ghost ${out}Lv ${g.level} · ${g.kills} kills (${signed(d)})`, ahead: d >= 0 };
}

/** The fields of a store.list() entry that the Challenges list reads. */
export type ChallengeEntry = Pick<ReplayEntry, 'mode' | 'seed' | 'label' | 'time' | 'kills' | 'room'> & { stale: boolean };
export interface ChallengeRow {
  mode: ModeName;
  seed: number;
  title: string;
  line: string;
  stale: boolean;
}

// Rows for the Challenges list: entries come from store.list().
export const challengeRows = (entries: ChallengeEntry[]): ChallengeRow[] =>
  entries.map((e) => ({
    mode: e.mode,
    seed: e.seed,
    title: `${e.mode === 'rooms' ? 'Keep' : 'Pit'} · ${e.label || `Seed ${e.seed}`}`,
    line: e.mode === 'rooms' ? `Room ${e.room} · ${e.kills} kills` : `${clock(e.time)} · ${e.kills} kills`,
    stale: e.stale,
  }));

const IMPORT_ERRORS: Record<string, string> = {
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
export const importLabel = (prev: { label: string } | undefined) => prev?.label || 'Imported';
// Label for a race against a stored entry: "Imported" names where that run came from, not your new run.
export const raceLabel = (entry: { label: string } | undefined) => (!entry || entry.label === 'Imported' ? '' : entry.label);
// Pasted share codes often arrive wrapped or indented (chat apps, email): a code never contains whitespace, so drop it all.
export const pastedCode = (text: string | null | undefined) => String(text ?? '').replace(/\s+/g, '');
// `undefined` (an error without a code) looked up the key "undefined", which is not in the table: same fallback.
export const importError = (code: string | undefined) => (code === undefined ? undefined : IMPORT_ERRORS[code]) ?? 'Could not import that code';
