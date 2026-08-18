// Both the StateField (block replace) and the ViewPlugin (structure marks) need
// to know where the frontmatter block lives — the field to decorate it, the plugin
// to leave it alone. Rather than share the field's state, each re-derives the span
// from the pure book parser: cheap, and keeps the two providers independent.
//
// CM's document lines are 1-based; parseBookDoc speaks 0-based model lines. The
// conversion (model line n → CM line n + 1) lives here, in one place.

import type { EditorState } from "@codemirror/state"

import { parseBookDoc } from "../../shared/book/parse"

export type FrontmatterSpan =
  | { kind: "none" }
  | {
      kind: "some"
      from: number
      to: number
      fromLine: number
      toLine: number
      fields: readonly (readonly [string, string])[]
    }

type Found =
  | { kind: "found"; fromLine: number; toLine: number; fields: readonly (readonly [string, string])[] }
  | { kind: "absent" }

export function frontmatterSpan(state: EditorState): FrontmatterSpan {
  const block = firstFrontmatter(state)

  switch (block.kind) {
    case "absent":
      return { kind: "none" }
    case "found":
      return locate(state, block)
  }
}

function firstFrontmatter(state: EditorState): Found {
  const lines = docLines(state)
  const doc = parseBookDoc(lines)

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "frontmatter":
        return { kind: "found", fromLine: block.fromLine, toLine: block.toLine, fields: block.fields }
      default:
        break
    }
  }

  return { kind: "absent" }
}

function locate(state: EditorState, block: Extract<Found, { kind: "found" }>): FrontmatterSpan {
  const first = state.doc.line(block.fromLine + 1)
  const last = state.doc.line(block.toLine + 1)

  return {
    kind: "some",
    from: first.from,
    to: last.to,
    fromLine: block.fromLine,
    toLine: block.toLine,
    fields: block.fields,
  }
}

function docLines(state: EditorState): readonly string[] {
  const lines: string[] = []

  for (let n = 1; n <= state.doc.lines; n++) {
    lines.push(state.doc.line(n).text)
  }

  return lines
}
