import { afterEach, describe, it, expect } from "bun:test"

import { EditorState } from "@codemirror/state"
import type { TransactionSpec } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { CompletionContext } from "@codemirror/autocomplete"
import type { Completion, CompletionResult } from "@codemirror/autocomplete"

import { parseBookDoc } from "../../src/shared/book/parse"
import { buildCast } from "../../src/shared/book/cast"
import { characterCompletions, detectBinding, displayBefore, matchCharacters } from "../../src/renderer/editor/character-complete"
import { displayGender, rankCharacters, setCastGenders, castGenders } from "../../src/renderer/editor/cast-rank"
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

// ─── ranking ─────────────────────────────────────────────────────────────────
describe("displayBefore — reading the group being bound", () => {
  function display(line: string): string {
    return displayBefore(line, line.lastIndexOf("["))
  }

  it("reads the display text back from a `}[` opener", () => {
    expect(display("Ela sorriu. {Ela}[")).toBe("Ela")

    expect(display("{a moça}[")).toBe("a moça")
  })

  it("reads nothing from the other openers", () => {
    expect(display("Vi @[")).toBe("")

    expect(display("—[")).toBe("")
  })
})

describe("displayGender — the closed class only", () => {
  it("reads pt and en pronouns and articles from the leading word", () => {
    expect(displayGender("Ela")).toBe("f")
    expect(displayGender("a moça")).toBe("f")
    expect(displayGender("ele")).toBe("m")
    expect(displayGender("o velho")).toBe("m")
    expect(displayGender("She")).toBe("f")
  })

  it("abstains on everything else — names, eu, empty", () => {
    expect(displayGender("eu")).toBe("unknown")
    expect(displayGender("Mizoguchi")).toBe("unknown")
    expect(displayGender("")).toBe("unknown")
  })
})

// The cast used for ranking: two women, two men, one unknown — declared in an
// order the signals must visibly rearrange.
const RANKED_FRONT = [
  "---",
  "title: Demo",
  "character: Rui",
  "character: Marta",
  "character: Bento",
  "character: Alda",
  "character: Zimba",
  "---",
  "",
]

function rankedSource(body: string): readonly string[] {
  const text = [...RANKED_FRONT, body].join("\n")
  const cursor = text.indexOf("|", RANKED_FRONT.join("\n").length)
  const doc = text.slice(0, cursor) + text.slice(cursor + 1)
  const state = EditorState.create({ doc })

  return labels(characterCompletions(new CompletionContext(state, cursor, true)))
}

describe("ranking — gender, recency, declaration", () => {
  afterEach(() => setCastGenders([]))

  it("with no signals at all, declaration order stands", () => {
    expect(rankedSource("Chegaram todos. @[|")).toEqual(["Rui", "Marta", "Bento", "Alda", "Zimba"])
  })

  it("a feminine display lifts the women, keeps the unknown mid, sinks the men — none dropped", () => {
    setCastGenders([
      { slug: "rui", gender: "m" },
      { slug: "marta", gender: "f" },
      { slug: "bento", gender: "m" },
      { slug: "alda", gender: "f" },
      { slug: "zimba", gender: "unknown" },
    ])

    expect(rankedSource("Chegaram todos. {Ela}[|")).toEqual(["Marta", "Alda", "Zimba", "Rui", "Bento"])
  })

  it("a masculine display mirrors it", () => {
    setCastGenders([
      { slug: "rui", gender: "m" },
      { slug: "marta", gender: "f" },
      { slug: "bento", gender: "m" },
      { slug: "alda", gender: "f" },
      { slug: "zimba", gender: "unknown" },
    ])

    expect(rankedSource("Chegaram todos. {Ele}[|")).toEqual(["Rui", "Bento", "Zimba", "Marta", "Alda"])
  })

  it("recency decides inside a tier — the one mentioned nearest the cursor leads", () => {
    setCastGenders([
      { slug: "marta", gender: "f" },
      { slug: "alda", gender: "f" },
    ])

    expect(rankedSource("Marta saiu cedo. Alda ficou na sala. {Ela}[|")).toEqual([
      "Alda",
      "Marta",
      "Rui",
      "Bento",
      "Zimba",
    ])
  })

  it("recency alone reorders a bare opener — the scene's active people first", () => {
    expect(rankedSource("Zimba dormia. Bento lia perto. @[|")).toEqual(["Bento", "Zimba", "Rui", "Marta", "Alda"])
  })

  it("a binding payload counts as a mention — [Nome] is presence on the page", () => {
    expect(rankedSource("{Ela}[Alda] entrou. @[|")).toEqual(["Alda", "Rui", "Marta", "Bento", "Zimba"])
  })

  it("frontmatter declarations are NOT mentions — recency never reads them", () => {
    // Without the body-start guard, `character:` lines would hand every member
    // a position and quietly reverse declaration order.
    expect(rankedSource("Nada aconteceu ainda. @[|")).toEqual(["Rui", "Marta", "Bento", "Alda", "Zimba"])
  })

  it("gender outranks recency — a just-mentioned man still sinks under `Ela`", () => {
    setCastGenders([
      { slug: "rui", gender: "m" },
      { slug: "marta", gender: "f" },
      { slug: "bento", gender: "m" },
      { slug: "alda", gender: "f" },
      { slug: "zimba", gender: "unknown" },
    ])

    expect(rankedSource("Bento fechou a porta. {Ela}[|")).toEqual(["Marta", "Alda", "Zimba", "Bento", "Rui"])
  })

  it("ranking still applies under a typed partial with a shared prefix", () => {
    setCastGenders([
      { slug: "marta", gender: "f" },
      { slug: "bento", gender: "m" },
    ])

    const front = ["---", "character: Mario", "character: Marta", "---", ""]
    const text = [...front, "Chegaram. {Ela}[mar"].join("\n")
    const cursor = text.length
    const state = EditorState.create({ doc: text })

    expect(labels(characterCompletions(new CompletionContext(state, cursor, true)))).toEqual(["Marta", "Mario"])
  })

  it("the seam resets clean — a fresh book carries no stale genders", () => {
    expect(castGenders().size).toBe(0)
  })

  it("habit outranks everything — a display bound before leads with its usual member", () => {
    setCastGenders([
      { slug: "marta", gender: "f" },
      { slug: "rui", gender: "m" },
    ])

    // `{eu}` has always meant Rui; neither gender nor Marta's fresher mention
    // dislodges the author's own precedent.
    expect(rankedSource("{eu}[Rui] escrevi. Marta chegou. {eu}[|")).toEqual([
      "Rui",
      "Marta",
      "Bento",
      "Alda",
      "Zimba",
    ])
  })

  it("habit is per-display and case-folded — `{ela}` history says nothing about `{ele}`", () => {
    expect(rankedSource("{Ela}[Alda] saiu. {ela}[|")).toEqual(["Alda", "Rui", "Marta", "Bento", "Zimba"])

    expect(rankedSource("{Ela}[Alda] saiu. Bento entrou. {ele}[|")).toEqual([
      "Bento",
      "Alda",
      "Rui",
      "Marta",
      "Zimba",
    ])
  })
})

describe("multi-name bindings in the completion", () => {
  it("a comma opens the next name — the segment starts after it", () => {
    expect(at("{elas}[João, Ma|")).toEqual({ kind: "open", from: 13, partial: "Ma", closed: false })

    expect(at("{elas}[João,|")).toEqual({ kind: "open", from: 12, partial: "", closed: false })
  })

  it("offers the cast for the new segment, minus everyone already listed", () => {
    const { result } = sourceAt("{elas}[Maria Costa, |")

    expect(labels(result)).toEqual(["João", "Senhor Almeida"])
  })

  it("accepting the second name completes the group", () => {
    const { result, state } = sourceAt("{elas}[Maria Costa, jo|")

    expect(labels(result)).toEqual(["João"])

    const { doc, cursor } = accept(state, result!, result!.options[0]!)

    expect(doc.endsWith("{elas}[Maria Costa, João]")).toBe(true)
    expect(cursor).toBe(doc.length)
  })

  it("a `]` hugging the cursor is still stepped over, never doubled", () => {
    const { doc } = acceptOnly("{elas}[João, mar|]")

    expect(doc.endsWith("{elas}[João, Maria Costa]")).toBe(true)
    expect(doc.endsWith("]]")).toBe(false)
  })

  it("the display group's gender still ranks the segment across the comma", () => {
    setCastGenders([
      { slug: "joao", gender: "m" },
      { slug: "maria-costa", gender: "f" },
      { slug: "senhor-almeida", gender: "m" },
    ])

    const { result } = sourceAt("{elas}[João, |")

    expect(labels(result)).toEqual(["Maria Costa", "Senhor Almeida"])

    setCastGenders([])
  })
})

// The corners the earlier rounds left unpinned.
describe("openers that must never offer the cast", () => {
  it("a time pin `~[` takes a date, not a name", () => {
    expect(sourceAt("~[|").result).toBeNull()
  })

  it("an accent typed where the name has none still folds home", () => {
    expect(labels(sourceAt("Vi @[mâr|").result)).toEqual(["Maria Costa"])
  })
})
