import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { scanLine } from "../../src/shared/book/glyphs"
import type { Cast } from "../../src/shared/book/cast"
import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Lexicon } from "../../src/shared/lingua/lexicon"
import { analyzeParagraph } from "../../src/shared/lingua/pipeline"
import type { ParagraphAnalysis } from "../../src/shared/lingua/pipeline"
import { analyzeBook } from "../../src/shared/lingua/driver"
import type { LexiconSource } from "../../src/shared/lingua/driver"

const DICT_DIR = join(import.meta.dir, "../../resources/dictionaries")

function open(lang: string): Lexicon {
  const buffer = readFileSync(join(DICT_DIR, `${lang}.dict`))
  const opened = openLexicon(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))

  switch (opened.ok) {
    case false:
      throw new Error(`open ${lang}: ${opened.error.kind}`)
    case true:
      return opened.value
  }
}

const PT = open("pt-BR")

const CAST: Cast = { characters: [{ name: "Minoru", slug: "minoru" }, { name: "Kaede", slug: "kaede" }] }

function analyze(text: string): ParagraphAnalysis {
  return analyzeParagraph({ text, spans: scanLine(text, CAST), lexicon: PT, language: { kind: "pt-BR" } })
}

function wordAt(analysis: ParagraphAnalysis, sentence: number, token: number): string {
  const t = analysis.sentences[sentence]!.tokens[token]!

  switch (t.role) {
    case "content":
      return t.tagged.token.text
    case "punctuation":
      return t.token.text
  }
}

describe("discourse: an elided object resolves to the previous sentence's head", () => {
  const analysis = analyze(
    "O espaguete passou do ponto. @[Minoru] comeu assim mesmo, de pé, olhando o quintal do vizinho.",
  )

  it("links comeu across the sentence boundary to espaguete with discourse provenance", () => {
    expect(analysis.discourse.length).toBe(1)

    const link = analysis.discourse[0]!

    expect(link.kind).toBe("elided-object")
    expect(link.provenance).toBe("discourse")
    expect(link.fromSentence).toBe(1)
    expect(link.toSentence).toBe(0)
    expect(wordAt(analysis, link.fromSentence, link.fromToken)).toBe("comeu")
    expect(wordAt(analysis, link.toSentence, link.toToken)).toBe("espaguete")
  })
})

describe("discourse: a real object always beats the discourse pass", () => {
  const analysis = analyze("O espaguete passou do ponto. @[Minoru] comeu o pão.")

  it("builds no link once comeu found its own object", () => {
    expect(analysis.discourse).toEqual([])
  })
})

describe("discourse: a paragraph-initial transitive verb has no antecedent", () => {
  const analysis = analyze("@[Minoru] comeu assim mesmo.")

  it("builds no link when no sentence precedes in the paragraph", () => {
    expect(analysis.discourse).toEqual([])
  })
})

describe("discourse: a character does not eat himself", () => {
  const analysis = analyze("@[Minoru] chegou. @[Minoru] comeu assim mesmo.")

  it("skips the antecedent subject that is the eating character himself", () => {
    expect(analysis.discourse).toEqual([])
  })
})

describe("discourse: links never cross a paragraph boundary", () => {
  const BOOK = [
    "---",
    "language: pt-BR",
    "character: Minoru",
    "---",
    "",
    "O espaguete passou do ponto.",
    "",
    "@[Minoru] comeu assim mesmo.",
  ].join("\n")

  const SOURCE: LexiconSource = () => ({ kind: "some", value: PT })

  it("leaves the second paragraph's verb unlinked though the first offers a head", () => {
    const result = analyzeBook(BOOK, SOURCE)

    switch (result.ok) {
      case false:
        throw new Error(`analyzeBook failed: ${result.error.kind}`)
      case true:
        break
    }

    const links = result.value.paragraphs.flatMap((p) => p.analysis.discourse)

    expect(links).toEqual([])
  })
})
