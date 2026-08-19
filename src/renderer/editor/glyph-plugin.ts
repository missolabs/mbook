// Character glyphs in the book body: the hidden-sigil syntax an author writes
// (`@[Name]`, `{display}[Name]`, `—[Name] …`, `“[Name] …”`) renders as its clean
// display text with the sigil characters collapsed away. Every construct is
// same-line — glyphs never straddle a break — so this is a ViewPlugin scanning
// one visible line at a time through the pure `scanLine` seam, exactly as the
// markdown structure plugin scans nodes.
//
// The reveal rule is the one the whole live preview obeys: a span shows its raw
// source, every sigil back, the instant the cursor or a selection touches it, so
// the author edits the real characters. The cast the scanner binds names against
// is the book's own frontmatter, recomputed only when the document changes — a
// cursor move reuses the cached cast and only re-evaluates reveal.

import { RangeSetBuilder } from "@codemirror/state"
import type { EditorState, Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"

import type { Cast } from "../../shared/book/cast"
import { scanLine } from "../../shared/book/glyphs"
import { deriveCast } from "./doc-cast"
import type { LineSpan } from "../../shared/book/glyphs"
import { frontmatterSpan } from "./frontmatter-span"
import type { FrontmatterSpan } from "./frontmatter-span"
import { revealed } from "./reveal"
import type { Span } from "./reveal"

// An empty replace collapses the range with no residual width — the sigil is gone,
// not spaced over. The same construction the structure plugin uses to drop a mark.
const hide = Decoration.replace({})

function build(view: EditorView, cast: Cast): DecorationSet {
  const fm = frontmatterSpan(view.state)
  const selection = selectionSpans(view.state)
  const items: Range<Decoration>[] = []

  for (const range of view.visibleRanges) {
    const first = view.state.doc.lineAt(range.from).number
    const last = view.state.doc.lineAt(range.to).number

    for (let n = first; n <= last; n += 1) {
      collectLine(view.state, fm, cast, selection, n, items)
    }
  }

  return sorted(items)
}

// The frontmatter is the cast's declaration, not prose — its own StateField owns
// it and no glyph is recognized inside it, so those lines are skipped whole.
function collectLine(
  state: EditorState,
  fm: FrontmatterSpan,
  cast: Cast,
  selection: readonly Span[],
  lineNumber: number,
  items: Range<Decoration>[],
): void {
  switch (insideFrontmatter(fm, lineNumber - 1)) {
    case true:
      return
    case false:
      break
  }

  const line = state.doc.line(lineNumber)

  for (const span of scanLine(line.text, cast)) {
    collectSpan(line.from, selection, span, items)
  }
}

// scanLine's offsets are line-relative; the line's own start lifts them onto the
// document. Reveal is judged against the span's full range — touch anywhere in
// the rendered glyph and every one of its sigils comes back.
function collectSpan(base: number, selection: readonly Span[], span: LineSpan, items: Range<Decoration>[]): void {
  const full: Span = { from: base + span.from, to: base + span.to }

  switch (revealed(selection, full)) {
    case true:
      return
    case false:
      break
  }

  for (const range of span.hidden) {
    items.push(hide.range(base + range.from, base + range.to))
  }
}

function sorted(items: readonly Range<Decoration>[]): DecorationSet {
  // RangeSetBuilder demands strictly ascending starts. Hidden ranges arrive
  // ascending within a line and across lines, but sorting the whole batch keeps
  // the builder safe against any ordering the scanner might yield.
  const ordered = [...items].sort(byPosition)
  const builder = new RangeSetBuilder<Decoration>()

  for (const item of ordered) {
    builder.add(item.from, item.to, item.value)
  }

  return builder.finish()
}

function byPosition(a: Range<Decoration>, b: Range<Decoration>): number {
  switch (a.from === b.from) {
    case false:
      return a.from - b.from
    case true:
      return a.value.startSide - b.value.startSide
  }
}

function selectionSpans(state: EditorState): readonly Span[] {
  return state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
}

function insideFrontmatter(fm: FrontmatterSpan, zeroBasedLine: number): boolean {
  switch (fm.kind) {
    case "none":
      return false
    case "some":
      return zeroBasedLine >= fm.fromLine && zeroBasedLine <= fm.toLine
  }
}

export const glyphPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    cast: Cast

    constructor(view: EditorView) {
      this.cast = deriveCast(view.state)
      this.decorations = build(view, this.cast)
    }

    update(update: ViewUpdate): void {
      switch (update.docChanged) {
        case true:
          this.cast = deriveCast(update.view.state)
          this.decorations = build(update.view, this.cast)
          return
        case false:
          break
      }

      switch (update.selectionSet || update.viewportChanged) {
        case true:
          this.decorations = build(update.view, this.cast)
          return
        case false:
          return
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
