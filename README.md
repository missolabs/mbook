# mbook

A translucent markdown book editor for macOS. A single, focused window where
you write plain markdown and mbook renders a real book around it: true-size A5
pages with folios and running chapter headers, a composed title page, and a
navigator rail of page thumbnails. Built on Electron + TypeScript, bundled
with Bun and electron-vite.

## Development

```sh
bun install         # install dependencies
bun run dev         # launch the app with hot reload
bun test            # run the test suite
bun run typecheck   # type-check main + renderer
bun run dist        # build the signature-less .dmg and .zip into release/
```

## Writing conventions

| You type | mbook renders |
| --- | --- |
| `#` heading | the title page — title and frontmatter author on their own A5 page |
| `##` heading | a chapter — just the name; mbook numbers it (`Capítulo N`) |
| `---` on its own line | separator ornament |
| `--` then a letter | `—` travessão |
| straight quotes `"` `'` | smart quotes, automatically |
| `title:` / `author:` frontmatter | collapsed title · author strip |

Frontmatter lives at the top of the file between `---` fences; it collapses to
a small-caps strip unless the cursor is inside it.

## The page

The manuscript renders as discrete A5 sheets (148 × 210 mm at 100%): 19 mm
head and 22 mm foot margins, folio at the foot of every page after the
half-title, the chapter's name as a running header. Page breaks come from a
pure screen-true estimate of the A5 text block — honest, block-granular, and
live in the status bar as you write.

## Chrome

| Keys | |
| --- | --- |
| `⌘\` | toggle the navigator rail (chapters + page thumbnails; drag its edge to resize) |
| `⌘+` / `⌘-` / `⌘0` | zoom the page 50–200% without reflowing a single line |
