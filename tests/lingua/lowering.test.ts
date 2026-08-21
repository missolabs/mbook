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
import { analysisToRows } from "../../src/main/lingua/lower"

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

const BOTH: LexiconSource = (language: Language) => byId(dictId(language))

function byId(id: DictId): Optional<Lexicon> {
  switch (id) {
    case "pt-BR":
      return { kind: "some", value: PT }
    case "en":
      return { kind: "some", value: EN }
  }
}

function analyze(content: string): BookAnalysis {
  const result = analyzeBook(content, BOTH)

  switch (result.ok) {
    case false:
      throw new Error(`analyzeBook failed: ${result.error.kind}`)
    case true:
      return result.value
  }
}

const BOOK = [
  "---",
  "character: João",
  "character: Maria",
  "---",
  "",
  "—[João] Ele disse a verdade. @[Maria] sorriu.",
  "",
  "“[Maria] A casa é grande.”",
].join("\n")

describe("BookAnalysis -> relational rows", () => {
  const rows = analysisToRows(analyze(BOOK))

  it("maps the cast to character rows with slug, canonical name and gender", () => {
    expect(rows.characters).toEqual([
      { slug: "joao", canonical: "João", gender: "m" },
      { slug: "maria", canonical: "Maria", gender: "f" },
    ])
  })

  it("flattens every sentence across paragraphs, tagging paragraph_idx and idx", () => {
    const keys = rows.sentences.map((s) => `${s.paragraphIdx}:${s.idx}`)

    // Two sentences in the dialogue paragraph (idx 0), one in the written quote.
    expect(keys).toEqual(["0:0", "0:1", "1:0"])
  })

  it("keeps token indices dense and faithful so chunk heads and relations resolve", () => {
    const sentence = rows.sentences.find((s) => s.paragraphIdx === 0 && s.idx === 0)!

    expect(sentence.tokens.map((t) => t.idx)).toEqual(sentence.tokens.map((_t, i) => i))

    const verb = sentence.tokens.find((t) => t.lemma === "dizer")!
    expect(verb.pos).toBe("VERB")
    expect(verb.provenance).toBe("lexicon")

    for (const chunk of sentence.chunks) {
      expect(sentence.tokens[chunk.headIdx]).toBeDefined()
    }

    for (const relation of sentence.relations) {
      expect(sentence.tokens[relation.headTokenIdx]).toBeDefined()
      expect(sentence.tokens[relation.depTokenIdx]).toBeDefined()
    }
  })

  it("records punctuation tokens so no index gap opens under a chunk or relation", () => {
    const sentence = rows.sentences.find((s) => s.paragraphIdx === 0 && s.idx === 0)!
    const punct = sentence.tokens.filter((t) => t.pos === "PUNCT")

    expect(punct.length).toBeGreaterThan(0)
    expect(punct.every((t) => t.provenance === "punctuation")).toBe(true)
  })

  it("carries a pinned subject-of relation from the @[Maria] mention", () => {
    const pinned = rows.sentences
      .flatMap((s) => s.relations)
      .find((r) => r.relation === "subject-of" && r.provenance === "pinned")

    expect(pinned).toBeDefined()
  })

  it("carries each sentence's location: line and column 1-based, chapterless here", () => {
    const first = rows.sentences.find((s) => s.paragraphIdx === 0 && s.idx === 0)!

    // The dialogue paragraph sits on doc line 6 (1-based) and opens the line.
    expect(first).toMatchObject({ line: 6, col: 1 })
    expect(first.chapterIdx).toEqual({ kind: "none" })
    expect(first.chapterTitle).toEqual({ kind: "none" })

    const quote = rows.sentences.find((s) => s.paragraphIdx === 1)!
    expect(quote.line).toBe(8)
  })

  it("carries the chapter auto-number and title once a heading precedes the sentence", () => {
    const rows = analysisToRows(analyze(["# Livro", "", "## Primeiro", "", "A casa é grande."].join("\n")))
    const sentence = rows.sentences[0]!

    expect(sentence.chapterIdx).toEqual({ kind: "some", value: 1 })
    expect(sentence.chapterTitle).toEqual({ kind: "some", value: "Primeiro" })
    expect(sentence).toMatchObject({ line: 5, col: 1 })
  })

  it("maps attribution: speech to João, written to Maria, narration to null slug", () => {
    const speech = rows.sentences.find((s) => s.attributionKind === "speech")!
    expect(speech.attributionSlug).toEqual({ kind: "some", value: "joao" })

    const written = rows.sentences.find((s) => s.attributionKind === "written")!
    expect(written.attributionSlug).toEqual({ kind: "some", value: "maria" })
  })

  it("maps glyph spans to span rows with slug on resolved bindings", () => {
    const speech = rows.spans.find((s) => s.kind === "speech")!
    expect(speech.slug).toEqual({ kind: "some", value: "joao" })
    expect(speech.unresolvedName).toEqual({ kind: "none" })

    const written = rows.spans.find((s) => s.kind === "character-written")!
    expect(written.slug).toEqual({ kind: "some", value: "maria" })
  })

  it("records an unresolved mention's name instead of a slug", () => {
    const rows = analysisToRows(analyze(["---", "character: João", "---", "", "@[João] viu @[Rui]."].join("\n")))
    const rui = rows.spans.find((s) => s.unresolvedName.kind === "some")!

    expect(rui.unresolvedName).toEqual({ kind: "some", value: "Rui" })
    expect(rui.slug).toEqual({ kind: "none" })
  })

  it("flattens a discourse link with its paragraph and both sentence indices", () => {
    const rows = analysisToRows(
      analyze(
        [
          "---",
          "character: Minoru",
          "---",
          "",
          "Primeira nota.",
          "",
          "O espaguete passou do ponto. @[Minoru] comeu assim mesmo.",
        ].join("\n"),
      ),
    )

    expect(rows.discourseLinks.length).toBe(1)

    const link = rows.discourseLinks[0]!

    expect(link).toMatchObject({
      fromParagraphIdx: 1,
      fromSentenceIdx: 1,
      toParagraphIdx: 1,
      toSentenceIdx: 0,
      kind: "elided-object",
      provenance: "discourse",
    })

    // The token indices point at real token rows of the sentences they name.
    const from = rows.sentences.find((s) => s.paragraphIdx === 1 && s.idx === link.fromSentenceIdx)!
    const to = rows.sentences.find((s) => s.paragraphIdx === 1 && s.idx === link.toSentenceIdx)!

    expect(from.tokens[link.fromTokenIdx]!.lemma).toBe("comer")
    expect(to.tokens[link.toTokenIdx]!.form).toBe("espaguete")
  })
})
