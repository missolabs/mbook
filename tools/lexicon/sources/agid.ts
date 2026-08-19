// Parser for AGID infl.txt (Kevin Atkinson's Automatically Generated Inflection
// Database). Line grammar:  LEMMA TYPE: field | field | ...
//   TYPE ∈ {N, V, A} with an optional trailing `?` (questionable POS).
//   Fields are ` | `-separated slots; alternatives inside a slot are `, `
//   separated; an alternative may carry ` {gloss}`, a level digit, or trailing
//   `? ! < >` annotations, all stripped.
// Slot meaning by POS: NOUN -> plural; VERB(4 slots) -> past/pastpart/prog/3sg;
// VERB(other) -> generic finite; ADJ -> comparative/superlative.

import type { LexEntry, Pos } from "../format/model"

type AgidType = { pos: Pos; kind: "noun" | "verb" | "adj" }

function readType(tag: string): AgidType {
  const base = tag.replace(/\?$/, "")

  switch (base) {
    case "N":
      return { pos: "NOUN", kind: "noun" }
    case "V":
      return { pos: "VERB", kind: "verb" }
    case "A":
      return { pos: "ADJ", kind: "adj" }
    default:
      return { pos: "X", kind: "noun" }
  }
}

function cleanForm(alt: string): string {
  const token = alt.trim().split(/\s+/)[0]

  switch (token === undefined) {
    case true:
      return ""
    case false: {
      const noGloss = token!.replace(/\{.*$/, "")
      const trimmed = noGloss.replace(/^[^A-Za-z'’-]+/, "").replace(/[^A-Za-z'’-]+$/, "")
      return trimmed
    }
  }
}

function slotFeats(kind: "noun" | "verb" | "adj", slotCount: number): string[] {
  switch (kind) {
    case "noun":
      return new Array(slotCount).fill("PL")
    case "adj": {
      const labels = ["COMP", "SUP"]
      return new Array(slotCount).fill("").map((_, i) => {
        const l = labels[i]
        switch (l === undefined) {
          case true:
            return "COMP"
          case false:
            return l!
        }
      })
    }
    case "verb":
      switch (slotCount === 4) {
        case true:
          return ["PAST", "PASTPART", "PROG", "3SG"]
        case false:
          return new Array(slotCount).fill("FIN")
      }
  }
}

function parseLine(line: string): LexEntry[] {
  const idx = line.indexOf(": ")

  const colonOnly = line.endsWith(":")

  switch (idx < 0 && !colonOnly) {
    case true:
      return []
    case false:
      break
  }

  const headEnd = idx < 0 ? line.length - 1 : idx
  const head = line.slice(0, headEnd)
  const body = idx < 0 ? "" : line.slice(idx + 2)

  const lastSpace = head.lastIndexOf(" ")

  switch (lastSpace < 0) {
    case true:
      return []
    case false:
      break
  }

  const lemma = head.slice(0, lastSpace)
  const type = readType(head.slice(lastSpace + 1))

  const out: LexEntry[] = [{ form: lemma, lemma, pos: type.pos, feat: "", variant: "both" }]

  const slots = body.length === 0 ? [] : body.split(" | ")
  const feats = slotFeats(type.kind, slots.length)

  slots.forEach((slot, si) => {
    const feat = feats[si]!
    for (const alt of slot.split(", ")) {
      const form = cleanForm(alt)
      switch (form.length === 0) {
        case true:
          break
        case false:
          out.push({ form, lemma, pos: type.pos, feat, variant: "both" })
      }
    }
  })

  return out
}

export function parseAgid(text: string): LexEntry[] {
  const out: LexEntry[] = []

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "")
    switch (line.length === 0) {
      case true:
        break
      case false:
        for (const e of parseLine(line)) {
          out.push(e)
        }
    }
  }

  return out
}

export const _internal = { parseLine, cleanForm, readType }
