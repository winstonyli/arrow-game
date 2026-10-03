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
