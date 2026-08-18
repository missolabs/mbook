import { EditorView } from "@codemirror/view"
import type { Extension } from "@codemirror/state"

import { decideTypingAid } from "../../shared/book/aids"

// inputHandler is skipped while an IME composition is active, so deferred em-dash
// folding never fights dead keys or accented composition.
export function createTypingAids(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const single = text.length === 1 && from === to && view.state.selection.ranges.length === 1

    switch (single) {
      case false:
        return false
      case true:
        break
    }

    const line = view.state.doc.lineAt(from)
    const before = line.text.slice(0, from - line.from)

    const decision = decideTypingAid({ before, typed: text })

    switch (decision.kind) {
      case "pass":
        return false
      case "replace":
        view.dispatch({
          changes: { from: from - decision.deleteBefore, to, insert: decision.insert },
          selection: { anchor: from - decision.deleteBefore + decision.insert.length },
          userEvent: "input.type",
        })
        return true
    }
  })
}
