import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Entry, Lexicon } from "../../src/shared/lingua/lexicon"

const DICT_DIR = join(import.meta.dir, "../../resources/dictionaries")

function bytesOf(lang: string): Uint8Array {
  const buffer = readFileSync(join(DICT_DIR, `${lang}.dict`))

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

function open(lang: string): Lexicon {
  const opened = openLexicon(bytesOf(lang))

  switch (opened.ok) {
    case false:
      throw new Error(`open ${lang} failed: ${opened.error.kind}`)
    case true:
      return opened.value
  }
}

function posOf(entries: readonly Entry[], pos: string): Entry {
  const hit = entries.find((e) => e.pos === pos)

  switch (hit === undefined) {
    case true:
      throw new Error(`no ${pos} in ${JSON.stringify(entries)}`)
    case false:
      return hit!
  }
}

const ALL = { kind: "all" } as const
const US = { kind: "us" } as const
const UK = { kind: "uk" } as const

describe("header validation", () => {
  it("rejects bytes without the MBLX magic", () => {
    const bad = openLexicon(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))

    expect(bad.ok).toBe(false)
    switch (bad.ok) {
      case false:
        expect(bad.error.kind).toBe("bad-magic")
        return
      case true:
        throw new Error("expected failure")
    }
  })

  it("fails closed on an unsupported version", () => {
    const bytes = new Uint8Array([0x4d, 0x42, 0x4c, 0x58, 1, 0, 0, 0])

    const bad = openLexicon(bytes)

    switch (bad.ok) {
      case false:
        expect(bad.error).toEqual({ kind: "bad-version", found: 1 })
        return
      case true:
        throw new Error("expected failure")
    }
  })

  it("reports truncation when the file is cut short of its declared tables", () => {
    const bad = openLexicon(bytesOf("pt-BR").subarray(0, 256))

    switch (bad.ok) {
      case false:
        expect(bad.error.kind).toBe("truncated")
        return
      case true:
        throw new Error("expected failure")
    }
  })
})

describe("pt-BR real dictionary", () => {
  const pt = open("pt-BR")

  it("loads the compiled lexicon metadata", () => {
    expect(pt.lang).toBe("pt-BR")
    expect(pt.variantScheme).toBe("none")
    expect(pt.formCount).toBeGreaterThan(800000)
  })

  it("returns every analysis of a homograph, noun and verb alike", () => {
    const casa = pt.lookup("casa", ALL)

    expect(posOf(casa, "NOUN").lemma).toBe("casa")
    expect(posOf(casa, "VERB").lemma).toBe("casar")
  })

  it("finds multibyte UTF-8 forms via byte-ordered binary search", () => {
    expect(posOf(pt.lookup("café", ALL), "NOUN").lemma).toBe("café")
  })

  it("returns nothing for an unknown form", () => {
    expect(pt.lookup("zzzznope", ALL)).toEqual([])
  })
})

describe("en real dictionary", () => {
  const en = open("en")

  it("carries the us-uk variant scheme", () => {
    expect(en.lang).toBe("en")
    expect(en.variantScheme).toBe("us-uk")
  })

  it("resolves an irregular plural to its lemma", () => {
    const child = en.lookup("children", ALL).find((e) => e.lemma === "child")

    expect(child === undefined).toBe(false)
    expect(child!.pos).toBe("NOUN")
  })

  it("tags color as US and colour as UK spelling", () => {
    expect(posOf(en.lookup("color", ALL), "NOUN").variant).toBe("us")
    expect(posOf(en.lookup("colour", ALL), "NOUN").variant).toBe("uk")
  })

  it("filters spellings by scope while both-tagged forms always pass", () => {
    expect(en.lookup("colour", US)).toEqual([])
    expect(posOf(en.lookup("colour", UK), "NOUN").variant).toBe("uk")

    expect(en.lookup("color", UK)).toEqual([])
    expect(posOf(en.lookup("color", US), "NOUN").variant).toBe("us")

    expect(en.lookup("children", US).length).toBeGreaterThan(0)
    expect(en.lookup("children", UK).length).toBeGreaterThan(0)
  })
})

describe("syntax data section", () => {
  it("decodes into the typed closed-class and rule structures", () => {
    const en = open("en")

    expect(en.syntax.closedClass.abbreviations.length).toBeGreaterThan(0)
    expect(en.syntax.chunkRules.length).toBeGreaterThan(0)

    const np = en.syntax.chunkRules.find((r) => r.chunk === "NP")

    expect(np === undefined).toBe(false)
    expect(np!.pattern.length).toBeGreaterThan(0)

    const pt = open("pt-BR")

    expect(pt.syntax.closedClass.determiners.length).toBeGreaterThan(0)
  })
})
