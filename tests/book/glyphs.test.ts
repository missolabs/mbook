import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { buildCast } from "../../src/shared/book/cast"
import { scanLine, scanGlyphs } from "../../src/shared/book/glyphs"

const cast = buildCast(
  parseBookDoc([
    "---",
    "character: João",
    "character: Maria",
    "---",
  ]),
)

function only(text: string) {
  const spans = scanLine(text, cast)

  const [first] = spans

  if (first === undefined) {
    throw new Error(`expected one span in ${JSON.stringify(text)}`)
  }

  expect(spans.length).toBe(1)

  return first
}

describe("subject mentions", () => {
  it("reads @[Name] with the name as display and @[ / ] as the hidden sigils", () => {
    const span = only("@[João] acendeu.")

    expect(span.kind).toBe("subject-mention")
    expect(span.text).toBe("João")
    expect(span.binding).toEqual({ kind: "resolved", slug: "joao" })
    expect({ from: span.from, to: span.to }).toEqual({ from: 0, to: 7 })
    expect(span.hidden).toEqual([{ from: 0, to: 2 }, { from: 6, to: 7 }])
  })

  it("splits {display}[Name] into shown group and hidden braces plus binding", () => {
    const span = only("{o velho}[João] suspirou.")

    expect(span.kind).toBe("subject-mention")
    expect(span.text).toBe("o velho")
    expect(span.binding).toEqual({ kind: "resolved", slug: "joao" })
    expect({ from: span.from, to: span.to }).toEqual({ from: 0, to: 15 })
    expect(span.hidden).toEqual([{ from: 0, to: 1 }, { from: 8, to: 9 }, { from: 9, to: 15 }])
  })

  it("records an undeclared name as unresolved rather than failing", () => {
    const span = only("@[Pedro] correu.")

    expect(span.binding).toEqual({ kind: "unresolved", name: "Pedro" })
  })

  it("binds a mention written in a different case and accent", () => {
    const span = only("@[joão] riu.")

    expect(span.binding).toEqual({ kind: "resolved", slug: "joao" })
  })

  it("does not capture a bare [bracketed] phrase in ordinary prose", () => {
    expect(scanLine("[qualquer coisa] ficou no chão.", cast)).toEqual([])
  })
})

describe("dialogue", () => {
  it("classifies a bare travessão line as speech with an unknown speaker", () => {
    const span = only("— Olá.")

    expect(span.kind).toBe("speech")
    expect(span.binding).toEqual({ kind: "unknown" })
    expect(span.text).toBe("— Olá.")
    expect(span.hidden).toEqual([])
  })

  it("binds a travessão line to its speaker, hiding [Name] but keeping the space", () => {
    const span = only("—[João] Olá.")

    expect(span.kind).toBe("speech")
    expect(span.binding).toEqual({ kind: "resolved", slug: "joao" })
    expect(span.text).toBe("— Olá.")
    expect(span.hidden).toEqual([{ from: 1, to: 7 }])
  })
})

describe("written quotes", () => {
  it("marks a curly-quoted run bound by [Name] as character-written", () => {
    const span = only("“[Maria] Venha amanhã.”")

    expect(span.kind).toBe("character-written")
    expect(span.binding).toEqual({ kind: "resolved", slug: "maria" })
    expect(span.text).toBe("“Venha amanhã.”")
    expect(span.hidden).toEqual([{ from: 1, to: 9 }])
  })

  it("accepts a straight-quoted run just the same", () => {
    const span = only("\"[Maria] Venha.\"")

    expect(span.kind).toBe("character-written")
    expect(span.binding).toEqual({ kind: "resolved", slug: "maria" })
    expect(span.text).toBe("\"Venha.\"")
    expect(span.hidden).toEqual([{ from: 1, to: 9 }])
  })

  it("leaves an unbound quoted run as ordinary prose", () => {
    expect(scanLine("“Venha amanhã.”", cast)).toEqual([])
  })
})

describe("scanGlyphs", () => {
  it("lifts line-relative offsets to doc-absolute positions on the right line", () => {
    const spans = scanGlyphs(["primeira linha", "@[João] entrou."], cast)

    expect(spans).toEqual([
      {
        kind: "subject-mention",
        line: 1,
        from: 15,
        to: 22,
        hidden: [{ from: 15, to: 17 }, { from: 21, to: 22 }],
        text: "João",
        binding: { kind: "resolved", slug: "joao" },
      },
    ])
  })

  it("emits several mentions on one line, each anchored to its own offset", () => {
    const spans = scanGlyphs(["@[João] e @[Maria] falaram."], cast)

    const bounds = spans.map((span) => ({ from: span.from, to: span.to, text: span.text }))

    expect(bounds).toEqual([
      { from: 0, to: 7, text: "João" },
      { from: 10, to: 18, text: "Maria" },
    ])
  })
})
