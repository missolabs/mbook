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

describe("the narrator's continuity: one {Eu} glyph carries forward", () => {
  const BOOK = [
    "---",
    "language: pt-BR",
    "character: Narrador",
    "---",
    "",
    "{Eu}[Narrador] cheguei tarde. Escrevia poesias.",
    "",
    "Mudei de ideia naquela noite.",
  ].join("\n")

  it("links a later first-person verb to the paragraph's own eu-mention", () => {
    const analysis = analyze(BOOK, BOTH)
    const first = analysis.paragraphs[0]!.analysis

    const links = first.discourse.filter((d) => d.kind === "elided-subject")

    expect(links.length).toBe(1)
    expect(links[0]!.fromSentence).toBe(1)
    expect(links[0]!.toSentence).toBe(0)

    const to = first.sentences[0]!.tokens[links[0]!.toToken]!
    expect(to.role === "content" && to.tagged.token.text).toBe("Eu")
  })

  it("carries the mention ACROSS the paragraph break for a glyphless paragraph", () => {
    const analysis = analyze(BOOK, BOTH)

    const cross = analysis.bookLinks.filter((l) => l.kind === "elided-subject")

    expect(cross.length).toBe(1)
    expect(cross[0]!.fromParagraph).toBe(1)
    expect(cross[0]!.toParagraph).toBe(0)

    const from = analysis.paragraphs[1]!.analysis.sentences[cross[0]!.fromSentence]!.tokens[cross[0]!.fromToken]!
    expect(from.role === "content" && from.tagged.token.text).toBe("Mudei")
  })

  it("a third-person book claims no narrator continuity", () => {
    const book = ["---", "language: pt-BR", "character: Rei", "---", "", "@[Rei] chegou tarde."].join("\n")
    const analysis = analyze(book, BOTH)

    expect(analysis.bookLinks).toEqual([])
  })
})

describe("entity typing: ordered evidence, strongest rule wins", () => {
  it("a locative adposition types the name it introduces; the rest stay unknown", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "Mudei para S. Fiquei no B Bar. Rei viu Hellmanns no mercado.",
    ].join("\n")

    const analysis = analyze(book, BOTH)
    const byName = new Map(analysis.entities.map((e) => [e.name, e]))

    expect(byName.get("S")).toMatchObject({ kind: "place" })
    expect(byName.get("B Bar")).toMatchObject({ kind: "place" })
    expect(byName.get("Hellmanns")).toMatchObject({ kind: "unknown" })

    // Cast members are the cast's business, never entities.
    expect(byName.has("Rei")).toBe(false)
  })

  it("speaking outranks geography, typed heads claim by grammar, quotes claim nothing", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "A cidade de S era fria. Corra, disse Hellmanns. Li “Um estudo em Vermelho” no B Bar.",
    ].join("\n")

    const analysis = analyze(book, BOTH)
    const byName = new Map(analysis.entities.map((e) => [e.name, e]))

    expect(byName.get("S")).toMatchObject({ kind: "place" })
    expect(byName.get("Hellmanns")).toMatchObject({ kind: "person" })
    expect(byName.get("Vermelho")).toMatchObject({ kind: "unknown" })
    expect(byName.get("B Bar")).toMatchObject({ kind: "place" })
  })
})

describe("aliases, turns and chapter boundaries", () => {
  it("an appositive onto a cast member registers the description as an alias", () => {
    const book = ["---", "language: pt-BR", "character: Rei", "---", "", "Rei, o detetive, chegou cedo."].join("\n")
    const analysis = analyze(book, BOTH)

    expect(analysis.aliases).toEqual([{ slug: "rei", description: "detetive" }])
  })

  it("a later definite description resolves through the learned registry", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "Rei, o detetive, chegou cedo.",
      "",
      "O detetive sorriu.",
    ].join("\n")

    const analysis = analyze(book, BOTH)

    expect(analysis.aliasMentions).toEqual([{ paragraph: 1, sentence: 0, token: 1, slug: "rei" }])
  })

  it("unattributed dialogue turns alternate between the two participants", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "character: Daniela",
      "---",
      "",
      "—[Rei] — Você viu o gato?",
      "",
      "— Não vi nada.",
      "",
      "—[Rei] — Procure de novo.",
      "",
      "— Está bem.",
    ].join("\n")

    const analysis = analyze(book, BOTH)

    expect(analysis.turnGuesses).toEqual([
      { paragraph: 1, slug: "daniela" },
      { paragraph: 3, slug: "daniela" },
    ])
  })

  it("a chapter break is a time jump — no stitching across it", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "## ",
      "",
      "Rei chegou ao bar. Sentou na cadeira.",
      "",
      "## ",
      "",
      "Abriu o caderno. Escreveu a primeira linha.",
    ].join("\n")

    const analysis = analyze(book, BOTH)

    expect(analysis.timelineEdges).toEqual([])
  })

  it("head nouns type entities by kind, titles make persons", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "O gato Hellmanns dormia. Vi o Sr. Tanabe no mercado.",
    ].join("\n")

    const analysis = analyze(book, BOTH)
    const byName = new Map(analysis.entities.map((e) => [e.name, e]))

    expect(byName.get("Hellmanns")).toMatchObject({ kind: "animal" })
    expect(byName.get("Tanabe")).toMatchObject({ kind: "person" })
    expect(byName.has("Sr")).toBe(false)
  })
})

describe("authored time pins, declarations and the lint surface", () => {
  const BOOK = [
    "---",
    "language: pt-BR",
    "character: Rei",
    "place: B Bar",
    "object: caderno",
    "---",
    "",
    "## ",
    "",
    "Rei chegou ao B Bar. Abriu o caderno.",
    "",
    "~[antes] Rei comprou o caderno na cidade.",
    "",
    "## ",
    "",
    "~[1994] Rei escreveu a primeira linha.",
  ].join("\n")

  it("a retreat pin reverses the stitch, an absolute pin crosses the chapter", () => {
    const analysis = analyze(BOOK, BOTH)

    expect(analysis.timelineEdges).toMatchObject([
      // ~[antes]: the buying precedes the arrival scene.
      { fromParagraph: 1, toParagraph: 0, kind: "before", provenance: "pinned" },
      // ~[1994]: authored, so the chapter break stitches after all.
      { fromParagraph: 1, toParagraph: 2, kind: "before", provenance: "pinned" },
    ])
  })

  it("the pin payload rides the paragraph's timeline", () => {
    const analysis = analyze(BOOK, BOTH)

    expect(analysis.paragraphs[1]!.analysis.timeline.pins).toEqual(["antes"])
    expect(analysis.paragraphs[2]!.analysis.timeline.pins).toEqual(["1994"])
  })

  it("declared places and objects are entities by authorship", () => {
    const analysis = analyze(BOOK, BOTH)
    const byName = new Map(analysis.entities.map((e) => [e.name, e]))

    expect(byName.get("B Bar")).toMatchObject({ kind: "place", mentions: 1 })
    expect(byName.get("caderno")).toMatchObject({ kind: "object", mentions: 2 })
  })

  it("the compiler asks: contested tokens and unpinned chapter breaks surface", () => {
    const noPin = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "## ",
      "",
      "Rei chegou ao bar.",
      "",
      "## ",
      "",
      "Rei saiu do bar.",
    ].join("\n")

    const analysis = analyze(noPin, BOTH)
    const kinds = analysis.diagnostics.map((d) => d.kind)

    expect(kinds).toContain("unstitched-chapter")

    const contested = analyze("Casa é boa.", BOTH)

    expect(contested.diagnostics.some((d) => d.kind === "contested-token" && d.detail === "Casa")).toBe(true)
  })

  it("a dangling pronoun surfaces as a diagnostic", () => {
    const analysis = analyze("Vi Mizoguchi no mercado. Ela sorriu.", BOTH)

    expect(analysis.diagnostics.some((d) => d.kind === "unresolved-pronoun" && d.detail === "Ela")).toBe(true)
  })

  it("an authored glyph stands the pronoun lint down — empty brackets get their own note", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Daniela",
      "---",
      "",
      "Vi Mizoguchi no mercado. {Ela}[] sorriu.",
    ].join("\n")

    const analysis = analyze(book, BOTH)

    // The author already acted: never re-flag the word, never invite a
    // second wrap.
    expect(analysis.diagnostics.filter((d) => d.kind === "unresolved-pronoun")).toEqual([])

    const empty = analysis.diagnostics.filter((d) => d.kind === "empty-binding")

    expect(empty.length).toBe(1)
    expect(empty[0]!.detail).toBe("Ela")

    // The range covers the WHOLE glyph, so the fix lands the caret inside.
    const content = book
    expect(content.slice(empty[0]!.charFrom, empty[0]!.charTo)).toBe("{Ela}[]")
  })
})

describe("cast gender", () => {
  function genderOf(analysisMembers: ReturnType<typeof analyze>["castMembers"], slug: string): string {
    return analysisMembers.find((m) => m.slug === slug)?.gender ?? "missing"
  }

  it("reads dictionary genders for names the lexicon knows, unknown for the rest", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "character: Daniela",
      "character: Hellmanns",
      "---",
      "",
      "@[Rei] chegou cedo.",
    ].join("\n")

    const members = analyze(book, BOTH).castMembers

    expect(genderOf(members, "rei")).toBe("m")
    expect(genderOf(members, "daniela")).toBe("f")
    expect(genderOf(members, "hellmanns")).toBe("unknown")
  })

  it("falls back to the common-noun reading for a role-shaped name", () => {
    const book = ["---", "language: pt-BR", "character: Narrador", "---", "", "{eu}[Narrador] escrevi."].join("\n")

    expect(genderOf(analyze(book, BOTH).castMembers, "narrador")).toBe("m")
  })

  it("lets the author's own display groups gender an unknown name", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Hellmanns",
      "---",
      "",
      "{Ela}[Hellmanns] dormia no sofá. {Ela}[Hellmanns] acordou com fome.",
    ].join("\n")

    expect(genderOf(analyze(book, BOTH).castMembers, "hellmanns")).toBe("f")
  })

  it("authored evidence outranks the dictionary — the author's word is final", () => {
    // A cat named Daniela addressed as `ele`: the dictionary says fs, the
    // author says otherwise, twice to one.
    const book = [
      "---",
      "language: pt-BR",
      "character: Daniela",
      "---",
      "",
      "{Ele}[Daniela] dormia. {Ele}[Daniela] acordou.",
    ].join("\n")

    expect(genderOf(analyze(book, BOTH).castMembers, "daniela")).toBe("m")
  })

  it("a gender tie among display groups abstains and the dictionary decides", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Daniela",
      "---",
      "",
      "{Ela}[Daniela] saiu. {Ele}[Daniela] voltou.",
    ].join("\n")

    expect(genderOf(analyze(book, BOTH).castMembers, "daniela")).toBe("f")
  })

  it("a name-shaped display votes nothing — @[Rei] genders no one by itself", () => {
    const book = ["---", "language: pt-BR", "character: Hellmanns", "---", "", "@[Hellmanns] miou."].join("\n")

    expect(genderOf(analyze(book, BOTH).castMembers, "hellmanns")).toBe("unknown")
  })
})

describe("the timeline crosses paragraph breaks", () => {
  it("the last perfective of one paragraph precedes the first of the next", () => {
    const book = [
      "---",
      "language: pt-BR",
      "character: Rei",
      "---",
      "",
      "Rei chegou ao bar. Sentou na cadeira.",
      "",
      "Abriu o caderno. Escreveu a primeira linha.",
    ].join("\n")

    const analysis = analyze(book, BOTH)

    expect(analysis.timelineEdges.length).toBe(1)
    expect(analysis.timelineEdges[0]!).toMatchObject({
      kind: "before",
      fromParagraph: 0,
      toParagraph: 1,
      provenance: "narrative-advance",
    })

    const from = analysis.paragraphs[0]!.analysis.sentences[analysis.timelineEdges[0]!.fromSentence]!
    const token = from.tokens[analysis.timelineEdges[0]!.fromToken]!

    expect(token.role === "content" && token.tagged.token.text).toBe("Sentou")
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
