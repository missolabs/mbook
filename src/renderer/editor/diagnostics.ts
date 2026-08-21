// The lint surface, "sublinhado quieto": the analyzer's notes arrive as
// doc-absolute ranges and become quiet dotted underlines; the one under the
// caret goes gold (R1 — the open item is alive) and raises a small card with
// the quick fix. Enter applies it:
//   * an unowned pronoun wraps into `{Word}[]` and opens the cast completion;
//   * an out-of-cast name gains its `character:` frontmatter line;
//   * an unordered chapter break receives a `~[]` time pin;
//   * a contested word carries no action — the fix is the author's phrasing.
// Ranges map through edits and the whole set is replaced on every analysis.

import { StateEffect, StateField } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, keymap, showTooltip } from "@codemirror/view"
import type { DecorationSet, Tooltip, ViewUpdate } from "@codemirror/view"
import { RangeSetBuilder } from "@codemirror/state"
import { startCompletion } from "@codemirror/autocomplete"

export type DiagnosticItem = {
  kind: string
  from: number
  to: number
  detail: string
}

export const setDiagnostics = StateEffect.define<readonly DiagnosticItem[]>()

// A fix was applied: its diagnostic leaves the field AT ONCE, in the same
// transaction — Enter can never compound a stale note before the next
// analysis streams a fresh set.
const dismissDiagnostic = StateEffect.define<{ from: number; to: number }>()

const items = StateField.define<readonly DiagnosticItem[]>({
  create() {
    return []
  },
  update(value, tr) {
    let next = value

    switch (tr.docChanged) {
      case true:
        next = next.map((item) => ({
          ...item,
          from: tr.changes.mapPos(item.from),
          to: tr.changes.mapPos(item.to, 1),
        }))
        break
      case false:
        break
    }

    for (const effect of tr.effects) {
      switch (effect.is(setDiagnostics)) {
        case true:
          next = effect.value
          break
        case false:
          break
      }

      switch (effect.is(dismissDiagnostic)) {
        case true: {
          const gone = effect.value as { from: number; to: number }
          next = next.filter((item) => item.from !== gone.from || item.to !== gone.to)
          break
        }
        case false:
          break
      }
    }

    return next
  },
})

function activeAt(all: readonly DiagnosticItem[], head: number): DiagnosticItem | null {
  for (const item of all) {
    switch (head >= item.from && head <= item.to && item.to > item.from) {
      case true:
        return item
      case false:
        continue
    }
  }

  return null
}

const underlines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      const changed =
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnostics)))

      switch (changed) {
        case true:
          this.decorations = build(update.view)
          break
        case false:
          break
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const all = view.state.field(items)
  const head = view.state.selection.main.head
  const builder = new RangeSetBuilder<Decoration>()

  const sorted = [...all].sort((a, b) => a.from - b.from)

  for (const item of sorted) {
    switch (item.to > item.from && item.to <= view.state.doc.length) {
      case false:
        continue
      case true:
        break
    }

    const live = head >= item.from && head <= item.to

    builder.add(item.from, item.to, Decoration.mark({ class: live ? "mb-diag mb-diag-live" : "mb-diag" }))
  }

  return builder.finish()
}

// ─── the card ────────────────────────────────────────────────────────────────
const card = StateField.define<Tooltip | null>({
  create() {
    return null
  },
  update(_value, tr) {
    const all = tr.state.field(items)
    const head = tr.state.selection.main.head
    const active = activeAt(all, head)

    switch (active === null) {
      case true:
        return null
      case false:
        break
    }

    return {
      pos: active!.from,
      above: false,
      arrow: false,
      create: () => ({ dom: cardDom(active!, tr.state.sliceDoc(active!.from, active!.to)) }),
    }
  },
  provide: (field) => showTooltip.from(field),
})

function cardDom(item: DiagnosticItem, word: string): HTMLElement {
  const dom = document.createElement("div")
  dom.className = "mb-diag-card"

  const title = document.createElement("div")
  title.className = "mb-diag-card-title"
  title.textContent = titleOf(item.kind)
  dom.appendChild(title)

  const body = document.createElement("div")
  body.className = "mb-diag-card-body"
  body.textContent = bodyOf(item, word)
  dom.appendChild(body)

  const fix = fixOf(item.kind, word)

  switch (fix === null) {
    case true:
      break
    case false: {
      const line = document.createElement("div")
      line.className = "mb-diag-card-fix"

      const code = document.createElement("span")
      code.className = "mb-diag-card-code"
      code.textContent = fix!
      line.appendChild(code)

      const key = document.createElement("span")
      key.className = "mb-diag-card-key"
      key.textContent = "⏎"
      line.appendChild(key)

      dom.appendChild(line)
      break
    }
  }

  return dom
}

function titleOf(kind: string): string {
  switch (kind) {
    case "unresolved-pronoun":
      return "pronome sem dono"
    case "empty-binding":
      return "apelido vazio"
    case "unresolved-name":
      return "nome fora do elenco"
    case "unstitched-chapter":
      return "capítulo sem ordem"
    default:
      return "palavra em dúvida"
  }
}

function bodyOf(item: DiagnosticItem, word: string): string {
  switch (item.kind) {
    case "unresolved-pronoun":
      return `“${word}” não encontra antecedente. Fixar com um apelido:`
    case "empty-binding":
      return `“${item.detail}” está apelidado, mas os colchetes estão vazios. Escolher do elenco:`
    case "unresolved-name":
      return `“${item.detail}” não está no elenco. Declarar:`
    case "unstitched-chapter":
      return "A quebra de capítulo não tem ordem no tempo. Fixar:"
    default:
      return "Leitura escolhida só por prioridade — reformular resolve."
  }
}

function fixOf(kind: string, word: string): string | null {
  switch (kind) {
    case "unresolved-pronoun":
      return `{${word}}[…]`
    case "empty-binding":
      return "[…]"
    case "unresolved-name":
      return `character: ${word}`
    case "unstitched-chapter":
      return "~[…]"
    default:
      return null
  }
}

// ─── applying the fix ────────────────────────────────────────────────────────
function applyFix(view: EditorView): boolean {
  const all = view.state.field(items)
  const head = view.state.selection.main.head
  const active = activeAt(all, head)

  switch (active === null) {
    case true:
      return false
    case false:
      break
  }

  const dismissed = dismissDiagnostic.of({ from: active!.from, to: active!.to })

  switch (active!.kind) {
    case "unresolved-pronoun": {
      const word = view.state.sliceDoc(active!.from, active!.to)

      // IDEMPOTENT: a word already wearing its glyph (`{Ela}[` ahead) never
      // wraps again — the caret just lands inside the existing brackets.
      const before = view.state.sliceDoc(Math.max(0, active!.from - 1), active!.from)
      const after = view.state.sliceDoc(active!.to, Math.min(view.state.doc.length, active!.to + 2))

      switch (before === "{" && after === "}[") {
        case true: {
          view.dispatch({
            selection: { anchor: active!.to + 2 },
            effects: dismissed,
            userEvent: "select",
          })
          startCompletion(view)
          return true
        }
        case false:
          break
      }

      const insert = `{${word}}[]`

      view.dispatch({
        changes: { from: active!.from, to: active!.to, insert },
        selection: { anchor: active!.from + insert.length - 1 },
        effects: dismissed,
        userEvent: "input.complete",
      })

      startCompletion(view)
      return true
    }
    case "empty-binding": {
      // The glyph exists; land inside its brackets and offer the cast.
      const raw = view.state.sliceDoc(active!.from, active!.to)
      const open = raw.lastIndexOf("[")

      switch (open < 0) {
        case true:
          return false
        case false:
          break
      }

      view.dispatch({
        selection: { anchor: active!.from + open + 1 },
        effects: dismissed,
        userEvent: "select",
      })
      startCompletion(view)
      return true
    }
    case "unresolved-name": {
      const close = frontmatterClose(view)

      switch (close === null) {
        case true:
          return false
        case false:
          break
      }

      view.dispatch({
        changes: { from: close!, to: close!, insert: `character: ${detailOf(active!)}\n` },
        effects: dismissed,
        userEvent: "input.complete",
      })
      return true
    }
    case "unstitched-chapter": {
      const insert = "~[] "

      view.dispatch({
        changes: { from: active!.from, to: active!.from, insert },
        selection: { anchor: active!.from + 2 },
        effects: dismissed,
        userEvent: "input.complete",
      })
      return true
    }
    default:
      return false
  }
}

function detailOf(item: DiagnosticItem): string {
  return item.detail
}

// The offset of the frontmatter's closing `---` line — where a declaration
// slots in.
function frontmatterClose(view: EditorView): number | null {
  const doc = view.state.doc

  switch (doc.lines >= 2 && doc.line(1).text.trim() === "---") {
    case false:
      return null
    case true:
      break
  }

  for (let n = 2; n <= Math.min(doc.lines, 64); n++) {
    const line = doc.line(n)

    switch (line.text.trim() === "---") {
      case true:
        return line.from
      case false:
        continue
    }
  }

  return null
}

const fixKeymap = keymap.of([
  {
    key: "Enter",
    run: applyFix,
  },
])

export function diagnosticsExtension(): Extension {
  return [items, underlines, card, fixKeymap]
}
