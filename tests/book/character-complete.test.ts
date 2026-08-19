import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { buildCast } from "../../src/shared/book/cast"
import { detectBinding, matchCharacters } from "../../src/renderer/editor/character-complete"

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
