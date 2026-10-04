// window.arrowGame: the debug handle main.ts assigns at startup. Verify scripts and CDP harnesses read it.
import type { ModeName } from './game/game.ts';
import type { RenderGame } from './render/canvas.ts';
import type { Screen } from './ui/ui.ts';
import type { Replay } from './replay/codec.ts';
import type { LiveSession, TaggedRenderer, WatchSession } from './main.ts';

export interface ArrowGameDebug {
  readonly game: RenderGame;
  readonly screen: Screen;
  readonly mode: ModeName;
  readonly session: LiveSession | null;
  readonly lastReplay: Replay | null;
  readonly watch: WatchSession | null;
  readonly seed: number;
  /** Recent rAF intervals (median, p95) plus the smoothed sim and draw times, all in ms. */
  frameStats(): { n: number; medianMs: number; p95Ms: number; simMs: number; drawMs: number };
  renderer: TaggedRenderer['kind'];
}

declare global {
  interface Window {
    arrowGame: ArrowGameDebug;
  }
}
