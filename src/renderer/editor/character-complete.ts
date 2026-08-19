// Character-name completion: as the author opens a name binding the editor
// offers the declared cast, VS Code style. The list pops on any of the four
// binding openers the glyph scanner recognizes — a visible mention `@[`, a
// display group `}[`, a line-leading dialogue dash `—[`, or a written quote
// `“[` / `"[` — and never on a bare `[` in prose. Accepting a name closes the
// binding with its `]`, but never a second `]` when one already hugs the cursor.
//
// The whole decision — is the cursor in a binding opener, what has been typed so
// far, is a `]` already there — is the pure `detectBinding`, testable on plain
// strings with no CodeMirror in sight. The CompletionSource is the thin adapter
// that lifts an EditorState line into that function and back into CM's result.

import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"

import { foldKey } from "../../shared/book/cast"
import type { Cast, Character } from "../../shared/book/cast"
import { deriveCast } from "./doc-cast"

// A binding opener located relative to the start of its line: `from` is where the
// typed partial begins (just past the `[`), `partial` is what has been typed
// toward a name, and `closed` records that a `]` already sits at the cursor so
// acceptance must not add a second one.
export type Binding =
  | { kind: "none" }
  | { kind: "open"; from: number; partial: string; closed: boolean }

// The four openers, keyed by the character immediately before the `[`. The
// dialogue dash binds only when it starts the line (a mid-line `—[` is prose);
// the other three bind anywhere.
type Opener =
  | { kind: "anywhere" }
  | { kind: "line-lead" }
  | { kind: "not-an-opener" }

export function detectBinding(line: string, cursor: number): Binding {
  const before = line.slice(0, cursor)
  const bracket = before.lastIndexOf("[")

  switch (bracket < 0) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const partial = before.slice(bracket + 1)

  switch (partial.includes("]")) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  return classifyOpener(openerAt(line, bracket), bracket, partial, line[cursor] === "]")
}

function classifyOpener(opener: Opener, bracket: number, partial: string, closed: boolean): Binding {
  switch (opener.kind) {
    case "not-an-opener":
      return { kind: "none" }
    case "anywhere":
      return { kind: "open", from: bracket + 1, partial, closed }
    case "line-lead":
      return leadBinding(bracket, partial, closed)
  }
}

// The dialogue dash hugs the line start: `—[` binds only when the dash is the
// line's first character, so `[` sits at column 1. A `—[` deeper in the line is
// ordinary prose and opens nothing.
function leadBinding(bracket: number, partial: string, closed: boolean): Binding {
  switch (bracket === 1) {
    case false:
      return { kind: "none" }
    case true:
      return { kind: "open", from: bracket + 1, partial, closed }
  }
}

function openerAt(line: string, bracket: number): Opener {
  switch (line[bracket - 1]) {
    case "@":
      return { kind: "anywhere" }
    case "}":
      return { kind: "anywhere" }
    case "“":
      return { kind: "anywhere" }
    case "\"":
      return { kind: "anywhere" }
    case "—":
      return { kind: "line-lead" }
    default:
      return { kind: "not-an-opener" }
  }
}

// The cast filtered to those whose name begins with the typed partial, folded so
// `j`, `J` and a would-be `joão` all reach João. An empty partial folds to `""`,
// which prefixes every name — the opener alone offers the whole cast.
export function matchCharacters(cast: Cast, partial: string): readonly Character[] {
  const key = foldKey(partial)
  const matches: Character[] = []

  for (const character of cast.characters) {
    switch (foldKey(character.name).startsWith(key)) {
      case true:
        matches.push(character)
        continue
      case false:
        continue
    }
  }

  return matches
}

export function characterCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const binding = detectBinding(line.text, context.pos - line.from)

  switch (binding.kind) {
    case "none":
      return null
    case "open":
      break
  }

  const matches = matchCharacters(deriveCast(context.state), binding.partial)

  switch (matches.length === 0) {
    case true:
      return null
    case false:
      break
  }

  return {
    from: line.from + binding.from,
    to: context.pos,
    // We have already filtered and ordered by declaration; CM's fuzzy filter is
    // case- and accent-sensitive and would drop the very matches we want.
    filter: false,
    options: matches.map((character) => option(character, binding.closed)),
  }
}

function option(character: Character, closed: boolean): Completion {
  return { label: character.name, apply: applyName(character.name, closed) }
}

type Apply = (view: EditorView, completion: Completion, from: number, to: number) => void

function applyName(name: string, closed: boolean): Apply {
  return (view, _completion, from, to) => {
    const plan = insertPlan(name, closed)

    view.dispatch({
      changes: { from, to, insert: plan.insert },
      selection: { anchor: from + name.length + plan.step },
    })
  }
}

type InsertPlan = { insert: string; step: number }

// Both paths leave the cursor one place past the closing `]`. An unclosed
// binding writes the name and its own `]`; a binding already carrying a `]`
// writes only the name and steps over the bracket that was there.
function insertPlan(name: string, closed: boolean): InsertPlan {
  switch (closed) {
    case false:
      return { insert: name + "]", step: 1 }
    case true:
      return { insert: name, step: 1 }
  }
}
