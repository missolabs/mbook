import { describe, it, expect } from "bun:test"

import { EditorState } from "@codemirror/state"
import type { TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { CompletionContext } from "@codemirror/autocomplete"
import type { Completion, CompletionResult } from "@codemirror/autocomplete"

import { parseBookDoc } from "../../src/shared/book/parse"
import { buildCast } from "../../src/shared/book/cast"
import { characterCompletions, detectBinding, matchCharacters } from "../../src/renderer/editor/character-complete"
import { deriveCast } from "../../src/renderer/editor/doc-cast"

const cast = buildCast(
  parseBookDoc([
    "---",
    "character: João",
    "character: Maria Costa",
    "character: Senhor Almeida",
    "---",
  ]),
)

// The cursor is written as `|`; the fixture strips it and reports the column so a
// test reads as the author sees it.
function at(marked: string) {
  const cursor = marked.indexOf("|")
  const line = marked.slice(0, cursor) + marked.slice(cursor + 1)

  return detectBinding(line, cursor)
}

describe("detectBinding — the four openers", () => {
  it("opens on a visible mention `@[`, empty and with a partial", () => {
    expect(at("Ela viu @[|")).toEqual({ kind: "open", from: 10, partial: "", closed: false })

    expect(at("Ela viu @[Ma|")).toEqual({ kind: "open", from: 10, partial: "Ma", closed: false })
  })

  it("opens on a display-group binding `}[`", () => {
    expect(at("{o velho}[|")).toEqual({ kind: "open", from: 10, partial: "", closed: false })
  })

  it("opens on a line-leading dialogue dash `—[`, empty and with a partial", () => {
    expect(at("—[|")).toEqual({ kind: "open", from: 2, partial: "", closed: false })

    expect(at("—[Jo|")).toEqual({ kind: "open", from: 2, partial: "Jo", closed: false })
  })

  it("opens on a written quote, both curly `“[` and straight `\"[`", () => {
    expect(at("“[|")).toEqual({ kind: "open", from: 2, partial: "", closed: false })

    expect(at("\"[|")).toEqual({ kind: "open", from: 2, partial: "", closed: false })
  })
})

describe("detectBinding — what must NOT open", () => {
  it("ignores a bare `[` in ordinary prose", () => {
    expect(at("um [colchete| solto")).toEqual({ kind: "none" })
  })

  it("ignores a dialogue dash that does not start the line", () => {
    expect(at("ele disse —[|")).toEqual({ kind: "none" })
  })

  it("closes once the name's `]` has been typed before the cursor", () => {
    expect(at("@[João] disse|")).toEqual({ kind: "none" })
  })
})

describe("detectBinding — mid-line and already-closed", () => {
  it("finds an opener mid-line, anchored to its own bracket", () => {
    expect(at("A porta abriu e @[Mar|ia")).toEqual({ kind: "open", from: 18, partial: "Mar", closed: false })
  })

  it("reports a `]` already hugging the cursor so acceptance won't double it", () => {
    expect(at("@[|]")).toEqual({ kind: "open", from: 2, partial: "", closed: true })

    expect(at("@[Mar|]")).toEqual({ kind: "open", from: 2, partial: "Mar", closed: true })
  })
})

describe("matchCharacters", () => {
  it("offers the whole cast, in declaration order, for an empty partial", () => {
    const names = matchCharacters(cast, "").map((character) => character.name)

    expect(names).toEqual(["João", "Maria Costa", "Senhor Almeida"])
  })

  it("filters by prefix, case- and diacritic-insensitively", () => {
    expect(matchCharacters(cast, "j").map((c) => c.name)).toEqual(["João"])

    expect(matchCharacters(cast, "JOA").map((c) => c.name)).toEqual(["João"])

    expect(matchCharacters(cast, "maria c").map((c) => c.name)).toEqual(["Maria Costa"])
  })

  it("yields nothing when no declared name carries the prefix", () => {
    expect(matchCharacters(cast, "xyz")).toEqual([])
  })
})

// ─── the source over a real document ─────────────────────────────────────────
// From here down the tests leave the string helpers and run the actual
// CompletionSource against an EditorState, cursor written as `|` in the body.
// The frontmatter is the same three-name cast the pure tests use.

const FRONT = ["---", "title: Demo", "character: João", "character: Maria Costa", "character: Senhor Almeida", "---", ""]

function sourceAt(body: string): { result: CompletionResult | null; state: EditorState } {
  return sourceOver([...FRONT, body].join("\n"))
}

function sourceOver(marked: string): { result: CompletionResult | null; state: EditorState } {
  const cursor = marked.indexOf("|")
  const doc = marked.slice(0, cursor) + marked.slice(cursor + 1)
  const state = EditorState.create({ doc })

  return { result: characterCompletions(new CompletionContext(state, cursor, true)), state }
}

function labels(result: CompletionResult | null): readonly string[] {
  return (result?.options ?? []).map((option) => option.label)
}

describe("characterCompletions — offering", () => {
  it("offers the whole cast on a bare opener, in declaration order", () => {
    const { result } = sourceAt("A porta abriu. @[|")

    expect(labels(result)).toEqual(["João", "Maria Costa", "Senhor Almeida"])
  })

  it("computes from/to doc-absolute: from hugs the `[`, to sits at the cursor", () => {
    const { result, state } = sourceAt("Ela sorriu. {Ela}[Mar|ia")

    const bracket = state.doc.toString().lastIndexOf("[")

    expect(result?.from).toBe(bracket + 1)
    expect(result?.to).toBe(bracket + 1 + "Mar".length)
    expect(labels(result)).toEqual(["Maria Costa"])
  })

  it("narrows by the typed partial, accents and case folded", () => {
    expect(labels(sourceAt("@[jo|").result)).toEqual(["João"])

    expect(labels(sourceAt("@[SENHOR a|").result)).toEqual(["Senhor Almeida"])
  })

  it("turns CM's own fuzzy filter off — our fold already chose", () => {
    const { result } = sourceAt("@[jo|")

    expect(result?.filter).toBe(false)
  })

  it("binds at the LAST opener when the line already holds a closed one", () => {
    const { result, state } = sourceAt("@[João] olhou para @[Ma|")

    expect(result?.from).toBe(state.doc.toString().lastIndexOf("[") + 1)
    expect(labels(result)).toEqual(["Maria Costa"])
  })

  it("offers on the dialogue dash only when the dash leads the line", () => {
    expect(labels(sourceAt("—[|").result)).toEqual(["João", "Maria Costa", "Senhor Almeida"])

    expect(sourceAt("ele hesitou —[|").result).toBeNull()
  })

  it("stays quiet on a bare `[` in prose", () => {
    expect(sourceAt("um [colchete| solto").result).toBeNull()
  })

  it("stays quiet after the binding is closed", () => {
    expect(sourceAt("@[João] disse|").result).toBeNull()
  })

  it("stays quiet when no declared name carries the partial", () => {
    expect(sourceAt("@[xyz|").result).toBeNull()
  })

  it("stays quiet when the book declares no cast at all", () => {
    const bare = ["---", "title: Demo", "---", "", "Ela viu @[|"].join("\n")

    expect(sourceOver(bare).result).toBeNull()
  })
})

// Accepting an option: the Apply closure dispatches one transaction. A stub
// view captures it, the state applies it, and the assertions read the document
// the author would see — name written, binding closed exactly once, cursor one
// place past the `]`.
function accept(state: EditorState, result: CompletionResult, option: Completion): { doc: string; cursor: number } {
  let spec: TransactionSpec | null = null

  const view = {
    dispatch: (tr: TransactionSpec) => {
      spec = tr
    },
  } as unknown as EditorView

  const apply = option.apply as (view: EditorView, completion: Completion, from: number, to: number) => void
  apply(view, option, result.from, result.to ?? result.from)

  const next = state.update(spec!)

  return { doc: next.state.doc.toString(), cursor: next.state.selection.main.head }
}

function acceptOnly(body: string): { doc: string; cursor: number } {
  const { result, state } = sourceAt(body)

  expect(labels(result).length).toBe(1)

  return accept(state, result!, result!.options[0]!)
}

describe("characterCompletions — accepting", () => {
  it("writes the name and closes the binding on an unclosed opener", () => {
    const { doc, cursor } = acceptOnly("Ela sorriu. {Ela}[mar|")

    expect(doc.endsWith("Ela sorriu. {Ela}[Maria Costa]")).toBe(true)
    expect(cursor).toBe(doc.length)
  })

  it("replaces the typed partial with the canonical accented name", () => {
    const { doc } = acceptOnly("Vi @[jo| no mercado.")

    expect(doc.endsWith("Vi @[João] no mercado.")).toBe(true)
  })

  it("never doubles the `]` when one already hugs the cursor", () => {
    const { doc, cursor } = acceptOnly("{Ela}[jo|]")

    expect(doc.endsWith("{Ela}[João]")).toBe(true)
    expect(doc.endsWith("{Ela}[João]]")).toBe(false)
    expect(cursor).toBe(doc.length)
  })

  it("leaves the cursor one place past the `]` on both paths", () => {
    const open = acceptOnly("@[jo| disse.")
    expect(open.cursor).toBe(open.doc.indexOf("@[João]") + "@[João]".length)

    const closed = acceptOnly("@[jo|] disse.")
    expect(closed.cursor).toBe(closed.doc.indexOf("@[João]") + "@[João]".length)
  })

  it("touches nothing outside the binding", () => {
    const before = "A porta abriu e "
    const after = " entrou sem pressa."

    const { doc } = acceptOnly(`${before}@[senhor|${after}`)

    expect(doc.endsWith(`${before}@[Senhor Almeida]${after}`)).toBe(true)
  })
})

describe("deriveCast — the live document's cast", () => {
  it("projects character: frontmatter from the editor state, in order", () => {
    const state = EditorState.create({ doc: [...FRONT, "corpo"].join("\n") })

    expect(deriveCast(state).characters.map((c) => c.name)).toEqual(["João", "Maria Costa", "Senhor Almeida"])
  })

  it("sees a character the author just declared — no analysis round-trip", () => {
    const state = EditorState.create({ doc: [...FRONT, "corpo"].join("\n") })
    const close = state.doc.toString().lastIndexOf("---")

    const next = state.update({ changes: { from: close, insert: "character: Kumiko\n" } }).state

    expect(deriveCast(next).characters.map((c) => c.name)).toContain("Kumiko")

    expect(labels(characterCompletions(new CompletionContext(next, next.doc.length, true)))).toEqual([])
    const typed = next.update({ changes: { from: next.doc.length, insert: "\n@[ku" } }).state

    expect(labels(characterCompletions(new CompletionContext(typed, typed.doc.length, true)))).toEqual(["Kumiko"])
  })

  it("derives an empty cast from a book without frontmatter", () => {
    const state = EditorState.create({ doc: "Só prosa, sem elenco." })

    expect(deriveCast(state).characters).toEqual([])
  })
})
