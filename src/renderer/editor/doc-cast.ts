// The book's cast, derived from the live editor state: the whole document read
// out as lines, parsed, and projected to the cast the glyph scanner and the
// character completions both bind names against. The one place the renderer
// lifts an EditorState back into the pure book domain.

import type { EditorState } from "@codemirror/state"

import { buildCast } from "../../shared/book/cast"
import type { Cast } from "../../shared/book/cast"
import { parseBookDoc } from "../../shared/book/parse"

export function deriveCast(state: EditorState): Cast {
  return buildCast(parseBookDoc(docLines(state)))
}

function docLines(state: EditorState): readonly string[] {
  const lines: string[] = []

  for (let n = 1; n <= state.doc.lines; n += 1) {
    lines.push(state.doc.line(n).text)
  }

  return lines
}
