import { describe, it, expect } from "bun:test"
import { EditorState } from "@codemirror/state"

import { decideTypingAid } from "../../src/shared/book/aids"

// Mirrors the offset arithmetic of createTypingAids' inputHandler without a DOM:
// it derives `before` from the line the same way, then applies the decision's
// change/selection to plain EditorState. Pins that deleteBefore is measured back
// from `from` and the caret lands after the inserted text.
type Applied = { doc: string; caret: number }

function applyAid(doc: string, from: number, to: number, typed: string): Applied {
  const state = EditorState.create({ doc })
  const line = state.doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)

  const decision = decideTypingAid({ before, typed })

  switch (decision.kind) {
    case "pass":
      return { doc, caret: from }
    case "replace": {
      const next = state.update({
        changes: { from: from - decision.deleteBefore, to, insert: decision.insert },
        selection: { anchor: from - decision.deleteBefore + decision.insert.length },
      })
      return { doc: next.state.doc.toString(), caret: next.state.selection.main.head }
    }
  }
}

describe("createTypingAids offset math", () => {
  it("folds -- into an em dash carrying the typed letter", () => {
    const result = applyAid("--", 2, 2, "O")

    expect(result.doc).toBe("—O")
    expect(result.caret).toBe(2)
  })

  it("folds mid-line without disturbing the prefix", () => {
    const result = applyAid("Ele disse--", 11, 11, "q")

    expect(result.doc).toBe("Ele disse—q")
    expect(result.caret).toBe(11)
  })

  it("inserts a closing curly quote in place after a letter", () => {
    const result = applyAid("Olá", 3, 3, '"')

    expect(result.doc).toBe("Olá”")
    expect(result.caret).toBe(4)
  })
})
