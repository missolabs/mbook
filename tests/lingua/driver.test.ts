import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Lexicon } from "../../src/shared/lingua/lexicon"
import { dictId } from "../../src/shared/lingua/language"
import type { Language, DictId } from "../../src/shared/lingua/language"
import type { Optional } from "../../src/shared/optional"
import { analyzeBook } from "../../src/shared/lingua/driver"
import type { BookAnalysis, LexiconSource } from "../../src/shared/lingua/driver"

const DICT_DIR = join(import.meta.dir, "../../resources/dictionaries")

function open(id: DictId): Lexicon {
  const buffer = readFileSync(join(DICT_DIR, `${id}.dict`))
  const opened = openLexicon(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))

  switch (opened.ok) {
    case false:
      throw new Error(`open ${id}: ${opened.error.kind}`)
    case true:
      return opened.value
  }
}

const PT = open("pt-BR")
const EN = open("en")

// The real, loaded dictionaries behind the same seam the main process injects.
const BOTH: LexiconSource = (language: Language) => byId(dictId(language))

function byId(id: DictId): Optional<Lexicon> {
  switch (id) {
    case "pt-BR":
      return { kind: "some", value: PT }
    case "en":
      return { kind: "some", value: EN }
  }
}

const NONE: LexiconSource = () => ({ kind: "none" })

function analyze(content: string, source: LexiconSource): BookAnalysis {
  const result = analyzeBook(content, source)

  switch (result.ok) {
    case false:
      throw new Error(`analyzeBook failed: ${result.error.kind}`)
    case true:
      return result.value
  }
}

const PT_BOOK = [
  "---",
  "language: pt-BR",
  "character: João",
  "character: Maria",
  "---",
  "",
  "# Título",
  "",
  "—[João] Ele disse a verdade. @[Maria] sorriu.",
  "",
  "A casa era grande. Chovia lá fora.",
].join("\n")

describe("book-level composition against the real dictionaries", () => {
  const analysis = analyze(PT_BOOK, BOTH)

  it("selects the declared language and builds the whole cast", () => {
    expect(analysis.language.kind).toBe("pt-BR")
    expect(analysis.cast.characters.map((c) => c.slug).sort()).toEqual(["joao", "maria"])
  })

  it("analyzes every paragraph block, indexed in reading order, skipping titles and blanks", () => {
    expect(analysis.paragraphs.map((p) => p.index)).toEqual([0, 1])

    const dialogue = analysis.paragraphs[0]!
    expect(dialogue.analysis.sentences.length).toBe(2)

    const prose = analysis.paragraphs[1]!
    expect(prose.analysis.sentences.length).toBe(2)
  })

  it("re-bases doc-absolute glyph spans onto each paragraph so the analyzer tags the visible text", () => {
    const dialogue = analysis.paragraphs[0]!.analysis

    // The bound `[João]` sigil is stripped; the conventional em-dash survives.
    expect(dialogue.stripped.startsWith("— Ele disse a verdade.")).toBe(true)

    // Speech and the `@[Maria]` mention both anchored inside real sentences.
    const anchored = dialogue.spans.filter((s) => s.anchor.kind === "in-sentence")
    expect(anchored.length).toBe(2)
  })

  it("keeps book-level spans in doc-absolute coordinates with their bindings", () => {
    const speech = analysis.spans.find((s) => s.kind === "speech")!
    expect(speech.binding).toEqual({ kind: "resolved", slug: "joao" })
    expect(speech.line).toBe(8)

    const mention = analysis.spans.find((s) => s.kind === "subject-mention")!
    expect(mention.binding).toEqual({ kind: "resolved", slug: "maria" })

    // Doc-absolute: the mention sits on line 8, well past the file's start.
    expect(mention.from).toBeGreaterThan(30)
  })
})

describe("book-level pins and attribution survive composition", () => {
  it("pins @[Maria] as a subject-of relation on the sentence it opens", () => {
    const analysis = analyze(PT_BOOK, BOTH)
    const second = analysis.paragraphs[0]!.analysis.sentences[1]!

    const pinned = second.relations.find((r) => r.kind === "subject-of" && r.provenance === "pinned")
    expect(pinned).toBeDefined()
  })

  it("attributes the dialogue line to João as speech", () => {
    const analysis = analyze(PT_BOOK, BOTH)
    const first = analysis.paragraphs[0]!.analysis.sentences[0]!

    expect(first.attribution).toEqual({ kind: "speech", speaker: { kind: "slug", slug: "joao" } })
  })
})

describe("multi-line paragraph coordinates", () => {
  const book = ["Primeira linha da casa", "grande e a segunda. Fim."].join("\n")

  it("joins wrapped lines and keeps token offsets addressable in the joined text", () => {
    const analysis = analyze(book, BOTH)
    const slot = analysis.paragraphs[0]!

    expect(slot.fromLine).toBe(0)
    expect(slot.toLine).toBe(1)

    // A token from the second physical line is offset past the first line + its
    // joining newline, proving the "\n"-join coordinate system holds end to end.
    const words = slot.analysis.sentences.flatMap((s) =>
      s.tokens.flatMap((t) => (t.role === "content" ? [t.tagged.token] : [])),
    )
    const segunda = words.find((t) => t.text === "segunda")!
    expect(segunda.source.from).toBeGreaterThan("Primeira linha da casa".length)
  })

  it("locates a sentence starting mid-way through a wrapped line", () => {
    const analysis = analyze(book, BOTH)
    const slot = analysis.paragraphs[0]!

    expect(slot.locations[0]!).toMatchObject({ line: 1, col: 1 })
    expect(slot.locations[1]!).toMatchObject({ line: 2, col: "grande e a segunda. ".length + 1 })
  })
})

describe("sentence locations: chapter, line and column", () => {
  const book = [
    "---",
    "language: pt-BR",
    "---",
    "",
    "# Livro",
    "",
    "## A Máscara",
    "",
    "Kenzō compreendeu que a beleza era uma sentença. O mar batia.",
    "",
    "## O Mar",
    "",
    "A onda subiu.",
  ].join("\n")

  const analysis = analyze(book, BOTH)

  it("places every sentence under its chapter with a 1-based auto-number and title", () => {
    const first = analysis.paragraphs[0]!
    expect(first.locations[0]!.chapter).toEqual({ kind: "some", value: { index: 1, title: "A Máscara" } })

    const second = analysis.paragraphs[1]!
    expect(second.locations[0]!.chapter).toEqual({ kind: "some", value: { index: 2, title: "O Mar" } })
  })

  it("records the 1-based doc line and column of each sentence's first character", () => {
    const first = analysis.paragraphs[0]!
    expect(first.locations.length).toBe(first.analysis.sentences.length)

    expect(first.locations[0]!).toMatchObject({ line: 9, col: 1 })

    // The second sentence starts right after "...sentença. " on the same line.
    expect(first.locations[1]!).toMatchObject({ line: 9, col: 50 })

    expect(analysis.paragraphs[1]!.locations[0]!).toMatchObject({ line: 13, col: 1 })
  })

  it("marks a sentence before any chapter heading as chapterless", () => {
    const chapterless = analyze("Casa é boa.", BOTH)
    expect(chapterless.paragraphs[0]!.locations[0]!.chapter).toEqual({ kind: "none" })
  })
})

describe("unresolved references and the language default", () => {
  it("collects names that bind to no declared character, once each", () => {
    const book = ["---", "character: João", "---", "", "@[João] viu @[Rui]. @[Rui] correu."].join("\n")
    const analysis = analyze(book, BOTH)

    expect(analysis.unresolved).toEqual(["Rui"])
  })

  it("defaults an undeclared language to pt-BR and still resolves", () => {
    const analysis = analyze("Casa é boa.", BOTH)
    expect(analysis.language.kind).toBe("pt-BR")
  })
})

describe("a missing dictionary is a typed no-op, never a throw", () => {
  it("returns lexicon-unavailable carrying the language it could not serve", () => {
    const result = analyzeBook("Casa é boa.", NONE)

    switch (result.ok) {
      case true:
        throw new Error("expected lexicon-unavailable")
      case false:
        expect(result.error.kind).toBe("lexicon-unavailable")
        expect(result.error.language.kind).toBe("pt-BR")
    }
  })
})
