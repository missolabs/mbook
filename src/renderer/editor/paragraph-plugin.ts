// Book paragraph rhythm: continuation paragraphs carry a first-line indent
// (mb-para) and the blank source lines between them collapse to half a line
// (mb-blank) — the page reads with indents instead of gaps, as set books do.
// The first paragraph after a heading, a separator, the frontmatter, or the
// document start sits flush, in the classic manner. A text line directly under
// another text line is a run-on continuation of the same paragraph and is
// never indented.
//
// Line classes only — the pagination model mirrors the half-line blanks with
// its own half-unit accounting.

import { RangeSetBuilder } from "@codemirror/state"
import type { EditorState } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"

import { frontmatterSpan } from "./frontmatter-span"
import type { FrontmatterSpan } from "./frontmatter-span"

type LineKind = "blank" | "heading" | "separator" | "text"

const para = Decoration.line({ class: "mb-para" })
const blankLine = Decoration.line({ class: "mb-blank" })

function classify(text: string): LineKind {
  switch (text.trim().length === 0) {
    case true:
      return "blank"
    case false:
      break
  }

  switch (text === "---") {
    case true:
      return "separator"
    case false:
      break
  }

  switch (text.startsWith("# ") || text.startsWith("## ")) {
    case true:
      return "heading"
    case false:
      return "text"
  }
}

function build(view: EditorView): DecorationSet {
  const fm = frontmatterSpan(view.state)
  const builder = new RangeSetBuilder<Decoration>()

  for (const range of view.visibleRanges) {
    const first = view.state.doc.lineAt(range.from).number
    const last = view.state.doc.lineAt(range.to).number

    for (let n = first; n <= last; n += 1) {
      const line = view.state.doc.line(n)

      switch (insideFm(fm, n - 1)) {
        case true:
          continue
        case false:
          break
      }

      switch (classify(line.text)) {
        case "blank":
          builder.add(line.from, line.from, blankLine)
          continue
        case "heading":
        case "separator":
          continue
        case "text":
          break
      }

      switch (indented(view.state, fm, n)) {
        case true:
          builder.add(line.from, line.from, para)
          continue
        case false:
          continue
      }
    }
  }

  return builder.finish()
}

// A paragraph is indented when the nearest non-blank line above it is another
// paragraph. Directly-adjacent text is a run-on continuation (never indented),
// and a heading, separator, frontmatter, or the document start opens a flush
// paragraph.
function indented(state: EditorState, fm: FrontmatterSpan, lineNumber: number): boolean {
  switch (lineNumber === 1) {
    case true:
      return false
    case false:
      break
  }

  const previous = state.doc.line(lineNumber - 1)

  switch (classify(previous.text) === "text" && insideFm(fm, lineNumber - 2) === false) {
    case true:
      return false
    case false:
      break
  }

  for (let n = lineNumber - 1; n >= 1; n -= 1) {
    switch (insideFm(fm, n - 1)) {
      case true:
        return false
      case false:
        break
    }

    const kind = classify(state.doc.line(n).text)

    switch (kind) {
      case "blank":
        continue
      case "text":
        return true
      case "heading":
      case "separator":
        return false
    }
  }

  return false
}

function insideFm(fm: FrontmatterSpan, zeroBasedLine: number): boolean {
  switch (fm.kind) {
    case "none":
      return false
    case "some":
      return zeroBasedLine >= fm.fromLine && zeroBasedLine <= fm.toLine
  }
}

export const paragraphPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate): void {
      switch (update.docChanged || update.viewportChanged) {
        case true:
          this.decorations = build(update.view)
          return
        case false:
          return
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
