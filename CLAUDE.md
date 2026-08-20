# mbook

Translucent A5 book editor for macOS. Electron 34 + TypeScript + Bun
(electron-vite). Vanilla-TS renderer on CodeMirror 6 — no React; mdesign is
consumed as CSS only (`src/renderer/styles/mdesign.css`, generated — do not
edit).

## Commands

- `bun run dev` — launch with hot reload
- `bun test` — book domain suite (tests/book)
- `bun run typecheck` — tsc for main + renderer
- `bun run build` — build to out/ (what `electron .` serves)
- `bun run dist` — package .dmg/.zip into release/

## Conventions

- Code and architecture follow the mbot `mcode` and `marchitecture` skills:
  pure input→output functions, discriminated unions, switch over if-chains,
  Result/Optional over exceptions, one behavior per class, injected seams.
- Visual rules are mdesign's laws (header of mdesign.css): gold marks life
  only (R1), tints never new colors (R3), the hairline is the only line (R4),
  radius 0 on panes (R5).
- The pagination model (`src/shared/book/pagination.ts`) is a pure,
  screen-true estimate — its constants are derived from the rendered sheet
  (see the derivation comment). If editor typography changes, recalibrate.

## Architecture notes

- The book domain (`src/shared/book/`) is pure and fully tested; the renderer
  derives everything (navigator, statusbar, page joints) from one debounced
  `PageTracker.recompute` fan-out in `src/renderer/main.ts`.
- The linguistic engine (`src/shared/lingua/`) is structured as a compiler:
  preprocessor (sigils out, source map kept) → lexer → segmenter (statement
  splitting) → tagger (classification against the compiled symbol table) →
  parser (shallow phrase grammar shipped as data) → binder (16 relation
  kinds — subject/object/dative/oblique/predicate/agent/located-in/
  temporal/vocative/appositive/comparative/reflexive/adverbial/particle/
  light-verb/complement — each with polarity) → dataflow (cross-statement
  links: elisions, anaphora, coreference; the driver adds cross-paragraph
  links and entity typing).
  `pipeline.ts` is the front end, `driver.ts` the per-book compilation driver
  (paragraphs are translation units, chapter/line/col the debug info), and
  the main process is the backend: `lower.ts` flattens IR to rows,
  `store.ts` emits `lingua.db`. Each pass owns its output IR; `.dict` files
  are compiled offline by `tools/lexicon` (format in FORMAT.md).
- Pages render as real A5 sheets: `editor/page-breaks.ts` puts joint widgets
  (folio / gap / running header) in the flow, `editor/page-layer.ts` paints
  sheet surfaces behind the text and stretches each joint's fill so every
  sheet is exactly 210mm × zoom.
- Zoom is the `--mb-zoom` CSS factor: sheet mm dims and the base font scale
  together, so line breaks never reflow. After changing it, call
  `view.requestMeasure()` — CodeMirror observes nothing that moves.
- The navigator is an overlay (never a grid column): resizing or toggling it
  must never move the text area.

## Gotchas

- Vibrancy: `vibrancy: "under-window"` + alpha `backgroundColor` + clear html;
  never `transparent: true` (macOS resize artifact).
- CodeMirror base theme fights the sheet: `.cm-content` needs `flex: none`
  (else flex-grow stretches it) and `.cm-line` padding must be zeroed (6px/2px
  default skews the text column off-axis).
- Screenshot/drive workflow: launch with `--remote-debugging-port` and use CDP
  (`Page.captureScreenshot` + `Input.dispatch*`); `screencapture` fails from
  sandboxed sessions without Screen Recording TCC. CDP Meta modifier is 4.
- Bun needs `trustedDependencies: ["electron"]` or electron's postinstall is
  skipped.
