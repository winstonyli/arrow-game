# Changelog

Versioning and what counts as a release: see "Versioning and commits" in the README. Each entry names the
`SIM_VERSION` and `REPLAY_VERSION` it ships with.

## v0.2.0
TypeScript, Vite and Bun; no gameplay or sim change (`SIM_VERSION` 2, `REPLAY_VERSION` 1). The golden fixtures are byte-identical to v0.1.0 and still reproduce, so replays recorded on v0.1.0 stay valid.

- Every file in `src/`, `test/` and `scripts/` is strict TypeScript (`strict`, no `any` escape hatches, erasable syntax only, explicit `.ts` import specifiers); `bun run typecheck` runs `tsc --noEmit`.
- Vite serves the game (`bun run dev`, port 8000) and bundles it (`bun run build` to `dist/`, `bun run preview`); fonts are bundled from `assets/fonts/`. `scripts/serve.js` and the `start` script are gone.
- Bun installs (`bun.lock`), runs the tests (`bun test`, 231 pass) and the scripts. The tests keep `node:test` imports, so `node --test test/*.test.ts` still runs them on V8 as a cross-engine check.
- `bun run bench:render` (`scripts/render-bench.ts`, was `render-bench.mjs`) measures the `vite build` output through `vite preview` instead of its own static server; it now cleans up its Chrome profile and handles Ctrl+Break / console close.
- Benchmark tables in the README are labelled by engine: the existing sim and soak numbers are Node/V8; new Bun/JavaScriptCore runs and a new render baseline for the minified bundle are added beside them, not compared with them.
- Fix: a missing 2D canvas context now makes the WebGL renderer throw at construction, so `main.ts` falls back to Canvas2D. It used to fail on the first frame inside the rAF callback, which stopped the loop and froze the game.

## v0.1.0
`SIM_VERSION` 2, `REPLAY_VERSION` 1. First tagged release; unstable (0.x), nothing is promised to stay compatible.

- Core sim: typed-array world, fixed 60 Hz tick, spatial-grid collisions, Rooms and Arena modes, skills and level-ups.
- Renderers: WebGL2 instanced circles (default) with a Canvas2D fallback; DOM UI (title, HUD, pause, skill picker, game over) and personal bests.
- Replays and challenges: seeded runs, replay recording, ghost race, watch viewer, Challenges screen with daily and custom seeds, share codes, import, replay store.
- Gems are captured into a damped orbit around the player (`SIM_VERSION` 2).
- Movement trails: tails bend through each mover's real path (per-tick position history, drawn as a smooth curve); player and blades use the same tail.
- `scripts/render-bench.mjs --mode=background|headed|headless`: the benchmark no longer needs a focused window.
