import { describe, it, expect } from "bun:test"

import type { Dictionary, LexEntry, Variant } from "../format/model"
import type { Entry } from "../format/decode"
import { encodeDictionary } from "../format/encode"
import { decodeDictionary } from "../format/decode"
import type { DictHandle } from "../format/decode"
import { parseAgid } from "../sources/agid"
import { parseMoby } from "../sources/moby"
import { parseVarcon } from "../sources/varcon"
import { parseDelaf } from "../sources/delaf"
import { EN_SYNTAX } from "../syntax/en"
import { PT_BR_SYNTAX } from "../syntax/pt-BR"

function open(dict: Dictionary): DictHandle {
  const decoded = decodeDictionary(encodeDictionary(dict))

  switch (decoded.ok) {
    case false:
      throw new Error(`decode failed: ${decoded.error}`)
    case true:
      return decoded.value
  }
}

function withVariant(entries: LexEntry[], variants: Map<string, Variant>): LexEntry[] {
  return entries.map((e) => {
    const v = variants.get(e.form)
    switch (v === undefined) {
      case true:
        return e
      case false:
        return { form: e.form, lemma: e.lemma, pos: e.pos, feat: e.feat, variant: v! }
    }
  })
}

function findEntry(entries: Entry[], pos: string, feat: string): Entry {
  const hit = entries.find((e) => e.pos === pos && e.feat === feat)

  switch (hit === undefined) {
    case true:
      throw new Error(`no ${pos}/${feat} in ${JSON.stringify(entries)}`)
    case false:
      return hit!
  }
}

const AGID_FIXTURE = [
  "run V: ran | run | running | runs",
  "mouse N: mice",
  "colour N: colours",
  "color N: colors",
  "big A: bigger | biggest",
].join("\n")

const MOBY_FIXTURE = ["the\\D", "run\\Vti", "a la carte\\Av"].join("\n")

const VARCON_FIXTURE = ["# color", "A Cv DV: color / B C D: colour"].join("\n")

const DELAF_FIXTURE = [
  "﻿casa,casa.N:fs",
  "casa,casar.V:P3s",
  "amada,amar.V:Kfs",
  "à,ao.PREPXDET+Art+Def:fs",
  "ama-a,amar.V+PRO:P3s",
  "café,café.N:ms",
].join("\r\n")

describe("English lexicon round-trip", () => {
  const variants = parseVarcon(VARCON_FIXTURE)
  const merged = withVariant([...parseAgid(AGID_FIXTURE), ...parseMoby(MOBY_FIXTURE)], variants)
  const dict: Dictionary = { lang: "en", variantScheme: "us-uk", entries: merged, syntax: EN_SYNTAX }
  const h = open(dict)

  it("resolves an inflected form to lemma, POS and morphology", () => {
    const running = findEntry(h.lookup("running"), "VERB", "PROG")
    expect(running.lemma).toBe("run")

    const mice = findEntry(h.lookup("mice"), "NOUN", "PL")
    expect(mice.lemma).toBe("mouse")

    const biggest = findEntry(h.lookup("biggest"), "ADJ", "SUP")
    expect(biggest.lemma).toBe("big")
  })

  it("tags US/UK spelling variants from VarCon and defaults the rest to both", () => {
    expect(findEntry(h.lookup("color"), "NOUN", "").variant).toBe("us")
    expect(findEntry(h.lookup("colour"), "NOUN", "").variant).toBe("uk")
    expect(findEntry(h.lookup("running"), "VERB", "PROG").variant).toBe("both")
  })

  it("adds closed-class POS from Moby and skips multi-word entries", () => {
    expect(findEntry(h.lookup("the"), "DET", "").lemma).toBe("the")
    expect(h.lookup("a la carte")).toEqual([])
  })

  it("returns no entries for an unknown form", () => {
    expect(h.lookup("zzzznope")).toEqual([])
  })

  it("preserves metadata and the syntax section byte-for-byte", () => {
    expect(h.lang).toBe("en")
    expect(h.variantScheme).toBe("us-uk")
    expect(JSON.stringify(h.syntax)).toBe(JSON.stringify(EN_SYNTAX))
  })
})

describe("pt-BR lexicon round-trip", () => {
  const dict: Dictionary = {
    lang: "pt-BR",
    variantScheme: "none",
    entries: parseDelaf(DELAF_FIXTURE),
    syntax: PT_BR_SYNTAX,
  }
  const h = open(dict)

  it("returns every analysis of a homograph surface form", () => {
    const casa = h.lookup("casa")
    expect(casa.length).toBe(2)
    expect(findEntry(casa, "NOUN", "fs").lemma).toBe("casa")
    expect(findEntry(casa, "VERB", "P3s").lemma).toBe("casar")
  })

  it("maps DELAF POS+morph codes onto the universal scheme", () => {
    const amada = findEntry(h.lookup("amada"), "VERB", "Kfs")
    expect(amada.lemma).toBe("amar")
  })

  it("finds multibyte UTF-8 forms via byte-ordered binary search", () => {
    const contraction = findEntry(h.lookup("à"), "ADP", "fs")
    expect(contraction.lemma).toBe("ao")

    expect(findEntry(h.lookup("café"), "NOUN", "ms").lemma).toBe("café")
  })

  it("drops clitic verb+pronoun forms so they never ship", () => {
    expect(h.lookup("ama-a")).toEqual([])
  })
})

describe("format guards", () => {
  it("rejects bytes without the header magic", () => {
    const bad = decodeDictionary(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(bad.ok).toBe(false)
  })
})
