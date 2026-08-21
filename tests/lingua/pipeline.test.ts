import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { scanLine } from "../../src/shared/book/glyphs"
import type { Cast } from "../../src/shared/book/cast"
import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Lexicon } from "../../src/shared/lingua/lexicon"
import { analyzeParagraph } from "../../src/shared/lingua/pipeline"
import type { AnalyzedToken, TaggedToken } from "../../src/shared/lingua/tagger"
import type { Language } from "../../src/shared/lingua/language"
import { readLanguage, dictId, variantScope } from "../../src/shared/lingua/language"
import { parseBookDoc } from "../../src/shared/book/parse"

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
const EN = open("en")

const CAST: Cast = { characters: [{ name: "João", slug: "joao" }, { name: "Maria", slug: "maria" }] }

function analyze(text: string, lexicon: Lexicon, language: Language) {
  return analyzeParagraph({ text, spans: scanLine(text, CAST), lexicon, language })
}

// Flatten every tagged (word/number) token across sentences, in reading order.
function content(analysis: ReturnType<typeof analyze>): TaggedToken[] {
  const out: TaggedToken[] = []

  for (const sentence of analysis.sentences) {
    for (const token of sentence.tokens) {
      switch (token.role) {
        case "content":
          out.push(token.tagged)
          break
        case "punctuation":
          break
      }
    }
  }

  return out
}

function byText(analysis: ReturnType<typeof analyze>, text: string): TaggedToken {
  const hit = content(analysis).find((t) => t.token.text === text)

  switch (hit === undefined) {
    case true:
      throw new Error(`no token "${text}" in ${JSON.stringify(content(analysis).map((t) => t.token.text))}`)
    case false:
      return hit!
  }
}

describe("language selection from frontmatter", () => {
  it("reads a declared language and maps it to dictionary and variant scope", () => {
    const doc = parseBookDoc(["---", "language: en-UK", "---", "Text."])
    const language = readLanguage(doc)

    expect(language.kind).toBe("en-UK")
    expect(dictId(language)).toBe("en")
    expect(variantScope(language)).toEqual({ kind: "uk" })
  })

  it("defaults to pt-BR when the field is absent or unrecognized", () => {
    expect(readLanguage(parseBookDoc(["No frontmatter here."])).kind).toBe("pt-BR")
    expect(readLanguage(parseBookDoc(["---", "language: klingon", "---"])).kind).toBe("pt-BR")
  })
})

describe("pt-BR: travessão dialogue, clitic split, sigil-stripped offsets", () => {
  const text = "—[João] Ele disse-me a verdade."
  const analysis = analyze(text, PT, { kind: "pt-BR" })

  it("strips the bound [João] sigil but keeps the conventional em-dash and space", () => {
    expect(analysis.stripped).toBe("— Ele disse-me a verdade.")
  })

  it("splits the clitic verb+pronoun so each half hits the lexicon, with source offsets past the sigil", () => {
    const disse = byText(analysis, "disse")
    const me = byText(analysis, "me")

    expect(disse.token.source).toEqual({ from: 12, to: 17 })
    expect(disse.pos).toBe("VERB")
    expect(disse.lemma).toBe("dizer")

    // `me` sits after the dropped hyphen, its offsets measured in the ORIGINAL
    // text — i.e. after `[João]` was removed for tokenizing.
    expect(me.token.source).toEqual({ from: 18, to: 20 })
    expect(me.pos).toBe("PRON")
    expect(me.lemma).toBe("eu")
  })

  it("recovers a sentence-initial capitalized pronoun by casefolded fallback", () => {
    const ele = byText(analysis, "Ele")

    expect(ele.pos).toBe("PRON")
    expect(ele.provenance).toBe("closed-class")
  })

  it("re-anchors the speech span onto the single sentence it spans", () => {
    expect(analysis.spans.length).toBe(1)
    expect(analysis.spans[0]!.span.kind).toBe("speech")
    expect(analysis.spans[0]!.anchor.kind).toBe("in-sentence")
  })
})

describe("pt-BR: abbreviation is not a boundary; multi-sentence paragraph", () => {
  const analysis = analyze("O Sr. Almeida chegou. Ela sorriu.", PT, { kind: "pt-BR" })

  it("keeps `Sr.` inside its sentence and cuts only at the real terminals", () => {
    expect(analysis.sentences.length).toBe(2)

    const firstWords = firstContentText(analysis, 0)
    const secondWords = firstContentText(analysis, 1)

    expect(firstWords).toEqual(["O", "Sr", "Almeida", "chegou"])
    expect(secondWords).toEqual(["Ela", "sorriu"])
  })
})

function firstContentText(analysis: ReturnType<typeof analyze>, sentence: number): string[] {
  return analysis.sentences[sentence]!.tokens
    .filter((t: AnalyzedToken) => t.role === "content")
    .map((t) => (t.role === "content" ? t.tagged.token.text : ""))
}

describe("pt-BR: sentence-initial capitalized common word falls back to the lemma", () => {
  it("tags `Casa` at a sentence start as the common noun casa", () => {
    const casa = byText(analyze("Casa é boa.", PT, { kind: "pt-BR" }), "Casa")

    expect(casa.pos).toBe("NOUN")
    expect(casa.lemma).toBe("casa")

    // Noun and verb readings both survived every rule — the noun won on
    // priority alone, and the pick says so.
    expect(casa.provenance).toBe("contested")
  })
})

describe("en: contraction splitting (Penn convention)", () => {
  const analysis = analyze("I don't like it's colour.", EN, { kind: "en-US" })

  it("splits `don't` into a lexicon-taggable stem and a clitic tagged from the closed table", () => {
    const doTok = byText(analysis, "do")
    const nt = byText(analysis, "n't")

    expect(doTok.token.source).toEqual({ from: 2, to: 4 })
    expect(doTok.pos).toBe("VERB")

    expect(nt.token.source).toEqual({ from: 4, to: 7 })
    expect(nt.pos).toBe("PART")
    expect(nt.lemma).toBe("not")
    expect(nt.provenance).toBe("closed-class")
  })

  it("splits `it's` and reads the `'s` before a noun as the possessive marker", () => {
    expect(byText(analysis, "it").pos).toBe("PRON")

    const s = byText(analysis, "'s")
    expect(s.pos).toBe("PART")
    expect(s.feat).toBe("Poss")
  })

  it("keeps the auxiliary reading when `'s` precedes anything non-nominal", () => {
    const s = byText(analyze("It's gone.", EN, { kind: "en-UK" }), "'s")

    expect(s.pos).toBe("AUX")
    expect(s.lemma).toBe("be")
  })
})

describe("en: spelling variant scope decides whether a form resolves", () => {
  const text = "The colour was grey."

  it("resolves `colour` from the lexicon under en-UK", () => {
    const colour = byText(analyze(text, EN, { kind: "en-UK" }), "colour")

    expect(colour.pos).toBe("NOUN")
    expect(colour.provenance).toBe("lexicon")
  })

  it("leaves `colour` unknown under en-US, where only the US spelling is in scope", () => {
    const colour = byText(analyze(text, EN, { kind: "en-US" }), "colour")

    expect(colour.provenance).toBe("default")
  })
})

describe("en: a quoted written span is re-anchored to its sentence", () => {
  const text = "She wrote “[Maria] the colour is grey.”"
  const analysis = analyze(text, EN, { kind: "en-UK" })

  it("binds the written run to Maria and anchors it onto the covering tokens", () => {
    expect(analysis.spans.length).toBe(1)

    const anchored = analysis.spans[0]!
    expect(anchored.span.kind).toBe("character-written")
    expect(anchored.span.binding).toEqual({ kind: "resolved", slug: "maria" })
    expect(anchored.anchor.kind).toBe("in-sentence")
  })

  it("tokenizes the visible quote and tags its UK spelling from the lexicon", () => {
    expect(byText(analysis, "colour").pos).toBe("NOUN")
  })
})
