// Shared model for the mbook lexicon compiler.
//
// The compiler is a dev-only Bun tool: open linguistic datasets are parsed into
// LexEntry values, merged, and encoded into one .dict file per language. The
// runtime (a later step) reads the .dict via the format documented in FORMAT.md.

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

// One analysis of one surface form. `feat` is a short language-native
// morphology code ("" when the form carries none), stored opaquely and
// interpreted by the runtime linguistic engine — see FORMAT.md.
export type LexEntry = {
  form: string
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
  dicendi: string[]
  verbFeats: VerbFeatMarks
}

export type VariantScheme = "none" | "us-uk"

export type Dictionary = {
  lang: string
  variantScheme: VariantScheme
  entries: LexEntry[]
  syntax: SyntaxData
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T, E>(value: T): Result<T, E> {
  return { ok: true, value }
}

export function err<T, E>(error: E): Result<T, E> {
  return { ok: false, error }
}

export function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`)
}

// Wire codes: the binary encodes POS and Variant as bytes. These two functions
// are the single source of truth; the reader in FORMAT.md mirrors them exactly.

export function posToByte(pos: Pos): number {
  switch (pos) {
    case "NOUN":
      return 0
    case "PROPN":
      return 1
    case "VERB":
      return 2
    case "ADJ":
      return 3
    case "ADV":
      return 4
    case "PRON":
      return 5
    case "DET":
      return 6
    case "ADP":
      return 7
    case "CONJ":
      return 8
    case "NUM":
      return 9
    case "INTJ":
      return 10
    case "AUX":
      return 11
    case "PART":
      return 12
    case "X":
      return 13
    default:
      return assertNever(pos)
  }
}

export function byteToPos(b: number): Result<Pos, string> {
  switch (b) {
    case 0:
      return ok("NOUN")
    case 1:
      return ok("PROPN")
    case 2:
      return ok("VERB")
    case 3:
      return ok("ADJ")
    case 4:
      return ok("ADV")
    case 5:
      return ok("PRON")
    case 6:
      return ok("DET")
    case 7:
      return ok("ADP")
    case 8:
      return ok("CONJ")
    case 9:
      return ok("NUM")
    case 10:
      return ok("INTJ")
    case 11:
      return ok("AUX")
    case 12:
      return ok("PART")
    case 13:
      return ok("X")
    default:
      return err(`bad POS byte ${b}`)
  }
}

export function variantToByte(v: Variant): number {
  switch (v) {
    case "both":
      return 0
    case "us":
      return 1
    case "uk":
      return 2
    default:
      return assertNever(v)
  }
}

export function byteToVariant(b: number): Result<Variant, string> {
  switch (b) {
    case 0:
      return ok("both")
    case 1:
      return ok("us")
    case 2:
      return ok("uk")
    default:
      return err(`bad variant byte ${b}`)
  }
}

export function variantSchemeToByte(s: VariantScheme): number {
  switch (s) {
    case "none":
      return 0
    case "us-uk":
      return 1
    default:
      return assertNever(s)
  }
}

export function byteToVariantScheme(b: number): Result<VariantScheme, string> {
  switch (b) {
    case 0:
      return ok("none")
    case 1:
      return ok("us-uk")
    default:
      return err(`bad variant-scheme byte ${b}`)
  }
}
