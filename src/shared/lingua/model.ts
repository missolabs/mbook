// Runtime linguistic model: the enums, entry shape and syntax structures a
// compiled .dict decodes to, plus the two byte decoders and the byte-order
// comparator the reader binary-searches with. This is the shared vocabulary the
// engine (later steps) speaks; it touches neither node nor the DOM, so it
// compiles in every process. The wire codes here mirror FORMAT.md exactly.

import type { Optional } from "../optional"

export type Pos =
  | "NOUN"
  | "PROPN"
  | "VERB"
  | "ADJ"
  | "ADV"
  | "PRON"
  | "DET"
  | "ADP"
  | "CONJ"
  | "NUM"
  | "INTJ"
  | "AUX"
  | "PART"
  | "X"

export type Variant = "both" | "us" | "uk"

export type VariantScheme = "none" | "us-uk"

// One analysis of one surface form. `feat` is a short, language-native morphology
// code ("" when the form carries none); the engine interprets it opaquely.
export type Entry = {
  lemma: string
  pos: Pos
  feat: string
  variant: Variant
}

export type ChunkKind = "NP" | "VP" | "PP"

export type Quant = "one" | "opt" | "star"

export type PatItem = {
  pos: Pos
  quant: Quant
}

export type ChunkRule = {
  chunk: ChunkKind
  pattern: PatItem[]
}

export type SuffixRule = {
  suffix: string
  pos: Pos
}

export type ValencyFrame =
  | "intransitive"
  | "transitive"
  | "ditransitive"
  | "copular"
  | "prepositional"
  | "presentational"

export type ValencyHint = {
  lemma: string
  frame: ValencyFrame
}

export type ClosedClass = {
  determiners: string[]
  pronouns: string[]
  prepositions: string[]
  conjunctions: string[]
  adverbs: string[]
  abbreviations: string[]
}

// Which morphology-code prefixes mark a verb form finite, infinitive or past
// participle, in the dictionary's own feat vocabulary. A language whose
// infinitive is not morphologically distinct (English) declares no infinitive
// prefixes, and the rules gated on them simply never fire there.
export type VerbFeatMarks = {
  finitePrefixes: string[]
  infinitivePrefixes: string[]
  participlePrefixes: string[]
}

export type SyntaxData = {
  closedClass: ClosedClass
  chunkRules: ChunkRule[]
  suffixGuess: SuffixRule[]
  valency: ValencyHint[]
  complementizers: string[]
  relativePronouns: string[]
  relativePlaceAdverbs: string[]
  genitiveMarkers: string[]
  passiveAuxiliaries: string[]
  agentMarkers: string[]
  expletives: string[]
  // Verb-of-saying lemmas: dialogue attribution inverts around these
  // (`disse Rei`, `said Holmes`), so a postverbal proper noun is their subject.
  dicendi: string[]
  verbFeats: VerbFeatMarks
}

export function byteToPos(b: number): Optional<Pos> {
  switch (b) {
    case 0:
      return { kind: "some", value: "NOUN" }
    case 1:
      return { kind: "some", value: "PROPN" }
    case 2:
      return { kind: "some", value: "VERB" }
    case 3:
      return { kind: "some", value: "ADJ" }
    case 4:
      return { kind: "some", value: "ADV" }
    case 5:
      return { kind: "some", value: "PRON" }
    case 6:
      return { kind: "some", value: "DET" }
    case 7:
      return { kind: "some", value: "ADP" }
    case 8:
      return { kind: "some", value: "CONJ" }
    case 9:
      return { kind: "some", value: "NUM" }
    case 10:
      return { kind: "some", value: "INTJ" }
    case 11:
      return { kind: "some", value: "AUX" }
    case 12:
      return { kind: "some", value: "PART" }
    case 13:
      return { kind: "some", value: "X" }
    default:
      return { kind: "none" }
  }
}

export function byteToVariant(b: number): Optional<Variant> {
  switch (b) {
    case 0:
      return { kind: "some", value: "both" }
    case 1:
      return { kind: "some", value: "us" }
    case 2:
      return { kind: "some", value: "uk" }
    default:
      return { kind: "none" }
  }
}

export function byteToVariantScheme(b: number): Optional<VariantScheme> {
  switch (b) {
    case 0:
      return { kind: "some", value: "none" }
    case 1:
      return { kind: "some", value: "us-uk" }
    default:
      return { kind: "none" }
  }
}

// Unsigned byte comparison of two UTF-8 encodings: the total order the form
// table is sorted by and the reader MUST binary-search with. This is not
// JavaScript's UTF-16 `<`; the shorter string is smaller on a shared prefix.
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)

  let i = 0

  while (i < n) {
    const d = a[i]! - b[i]!

    switch (d === 0) {
      case false:
        return d
      case true:
        i++
    }
  }

  return a.length - b.length
}
