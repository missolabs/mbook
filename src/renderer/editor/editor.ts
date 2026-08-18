import { Annotation, EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { createBookExtensions } from "./extensions"

// Marks a transaction as a programmatic document replacement (open/restore/new)
// so the change listener can tell it apart from a user keystroke and not flag the
// load as an unsaved edit. DocSession dispatches full-doc swaps carrying this.
export const programmatic = Annotation.define<boolean>()

// A reflow is the pagination-relevant shape of an editor update: the text
// changed (re-parse, re-paginate) or only the caret moved (re-read the cached
// page). It fires on programmatic swaps too — a loaded book must repaginate —
// whereas onDocChanged stays user-only so a load is never flagged as an edit.
export type DocReflow = { kind: "doc" } | { kind: "selection" }

export type EditorHooks = {
  onDocChanged: () => void
  onReflow: (change: DocReflow) => void
}

export function createEditor(host: HTMLElement, hooks: EditorHooks): EditorView {
  const state = EditorState.create({
    doc: "",
    extensions: [...createBookExtensions(), changeListener(hooks)],
  })

  return new EditorView({ state, parent: host })
}

function changeListener(hooks: EditorHooks): Extension {
  return EditorView.updateListener.of((update) => {
    switch (update.docChanged) {
      case true: {
        hooks.onReflow({ kind: "doc" })

        const loaded = update.transactions.some(
          (tr) => tr.annotation(programmatic) === true,
        )

        switch (loaded) {
          case true:
            return
          case false:
            hooks.onDocChanged()
            return
        }
      }
      case false:
        break
    }

    switch (update.selectionSet) {
      case true:
        hooks.onReflow({ kind: "selection" })
        return
      case false:
        return
    }
  })
}
