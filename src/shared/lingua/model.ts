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

// Which morphology-code prefixes mark a verb form finite, infinitive, past
// participle or gerund, in the dictionary's own feat vocabulary. A language
// whose infinitive is not morphologically distinct (English) declares no
// infinitive prefixes, and the rules gated on them simply never fire there.
export type VerbFeatMarks = {
  finitePrefixes: string[]
  infinitivePrefixes: string[]
  participlePrefixes: string[]
  gerundPrefixes: string[]
  // Tense prefixes where 1st and 3rd person singular are morphologically
  // DISTINCT (pt falo/fala, falei/falou). Only a 1st/2nd-marked feat from one
  // of these tenses is trustworthy person evidence — the shared-form tenses
  // (imperfeito `falava`, condicional `falaria`) are person-ambiguous and the
  // dictionary's 1s label there is an artifact, not a fact.
  personDistinctPrefixes: string[]
  // Feat prefix -> tense/aspect sense, tried IN ORDER (so en PASTPART is
  // declared before PAST). The timeline vocabulary downstream features read.
  tenseSenses: TenseSense[]
}

export type TenseSense = {
  prefix: string
  sense: string
}

// A light-verb construction: verb + noun meaning one event (`dar um passeio`
// = passear, `take a walk` = walk). The pair identifies it; `lemma` is the
// unified event the pair denotes.
export type LightVerbHint = {
  verb: string
  noun: string
  lemma: string
}

// A discourse-level time adverb: sentence-initial `depois`/`then` confirms
// narrative advancement, `antes`/`earlier` retreats — the sentence's first
// perfective event lands BEFORE the current reference time instead of after.
export type TimeConnective = {
  form: string
  role: "advance" | "retreat"
}

// What a temporal subordinator says about its clause's event (sub) relative
// to the matrix event: `quando` makes sub meet the matrix, `enquanto` wraps
// the matrix inside sub, `porque` puts the cause before its effect, `until`
// ends the matrix at sub. "none" declares the subordinator atemporal
// (concessive `embora`, conditional `se`).
export type SubordinatorTime = {
  form: string
  edge: "sub-before-matrix" | "sub-meets-matrix" | "matrix-during-sub" | "matrix-meets-sub" | "none"
}

// The MEANING of a subordinate clause — temporal, causal, conditional,
// concessive — read off its subordinator; consumers of adverbial-of look the
// sense up here.
export type SubordinatorSense = {
  form: string
  sense: string
}

// A sentence-initial rhetorical connective: `mas`/`but` asserts CONTRAST with
// the previous sentence, `portanto`/`so` asserts CONSEQUENCE.
export type DiscourseMarker = {
  form: string
  sense: "contrast" | "consequence"
}

// A third-person pronoun that refers back: its surface form and the agreement
// feat ([mf][sp]) an antecedent must carry. An empty feat matches anything —
// the honest declaration for a language whose nouns carry no gender.
export type AnaphorHint = {
  form: string
  feat: string
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
  // Adpositions opening a recipient PP after a ditransitive (`deu o livro A
  // MARIA`, `gave the book TO Mary`) — the dative-of relation's licence.
  dativeMarkers: string[]
  // Words that flip a clause's polarity when they ride its verb.
  negators: string[]
  // Third-person referring pronouns with the agreement their antecedent must
  // show (ele->ms, she->fs); drives the dataflow anaphora pass.
  anaphoricPronouns: AnaphorHint[]
  // Possessives whose owner is discourse-given (`seu caderno` — whose?).
  possessivePronouns: string[]
  // Clitic pronoun classes: an accusative clitic riding a verb IS its object
  // (`me encontrou`, `disse-me`), a dative clitic its recipient, and the
  // reflexive marks the verb's argument as its own subject (`abraçaram-se`)
  // or the se-passive/impersonal (`vendem-se casas`).
  accusativeClitics: string[]
  dativeClitics: string[]
  reflexiveClitics: string[]
  // Conjunctions opening an adverbial subordinate clause (`quando`, `while`):
  // the clause's verb attaches to the matrix verb as adverbial-of.
  subordinators: string[]
  // The possessive relative (`cujo gato`, `whose cat`): the noun it precedes
  // is possessed by the antecedent.
  possessiveRelatives: string[]
  // Article definiteness, read by the coreference pass: an indefinite NP
  // introduces an entity, a later definite NP with the same head lemma
  // resumes it (`um poço` ... `o poço`).
  definiteArticles: string[]
  indefiniteArticles: string[]
  // Nouns that name time when they head an adjunct (`naquela noite`, `that
  // morning`) — their attachment is temporal-of, not plain modification.
  temporalNouns: string[]
  // Verb particles forming a unit with the verb (`gave UP`, `looked BACK`);
  // empty in Portuguese, which has no phrasal verbs.
  particles: string[]
  // The comparative scaffold: a degree adverb on the adjective (`mais alto`,
  // `more beautiful`) and the standard marker introducing what it is compared
  // to (`que`, `than`).
  degreeAdverbs: string[]
  thanMarkers: string[]
  // Lemmas heading the PERFECT periphrasis (ter/haver/have): with the passive
  // auxiliaries, the only verbs a participle/gerund chains onto in tagging.
  perfectAuxiliaries: string[]
  // Verb+noun pairs that denote one event (`dar um passeio` = passear).
  lightVerbs: LightVerbHint[]
  // Adpositions that govern PLACES (em/no/para, in/at/to): a proper noun they
  // introduce types as a place in the entity pass.
  locativeMarkers: string[]
  // Common nouns whose genitive/appositive names a PLACE by grammar alone:
  // `a cidade de S`, `the town of X` — the strongest place evidence.
  placeHeadNouns: string[]
  // The timeline lexicon: discourse time adverbs and what each temporal
  // subordinator asserts about clause order.
  timeConnectives: TimeConnective[]
  subordinatorTime: SubordinatorTime[]
  // The semantic label of each subordinate clause (temporal/causal/
  // conditional/concessive), and the sentence-initial rhetorical connectives.
  subordinatorSenses: SubordinatorSense[]
  discourseMarkers: DiscourseMarker[]
  // Meteorological verbs are impersonal: `Chovia.` continues no one's
  // subject and rains on no antecedent.
  weatherVerbs: string[]
  // Words that negate a clause from ARGUMENT position: `Ninguém veio`,
  // `nothing remained`, `no cat came`.
  negativeIndefinites: string[]
  // Modal lemmas: their chained complement is possibility/volition, not an
  // asserted event (`podia ter fugido`, `queria escrever`).
  modalVerbs: string[]
  // Non-factive attitude verbs: their complement clause is REPORTED, not
  // asserted (`achava que fugiu`). Factives assert theirs (`sabia que
  // fugiu`) and override membership in the reported class.
  reportingVerbs: string[]
  factiveVerbs: string[]
  // Degree words grading an adjective without comparing (`muito alto`,
  // `very tall`).
  intensifiers: string[]
  // The role predicate marker (`trabalhava COMO detetive`, `worked AS a
  // detective`).
  roleMarkers: string[]
  // The purpose-infinitive opener (`saiu PARA comprar pão`).
  purposeMarkers: string[]
  // Duration adjunct openers, gated on a temporal head (`POR dois anos`,
  // `FOR two years` — `for Mary` never fires).
  durationMarkers: string[]
  // Fronted adjunct interrogatives (`Onde ele mora?`, `Why did she leave?`).
  interrogativeAdverbs: string[]
  // Honorific titles: person evidence for the name they precede.
  personTitles: string[]
  // Typed head nouns for the entity pass, by kind (the place list already
  // exists as placeHeadNouns).
  personHeadNouns: string[]
  animalHeadNouns: string[]
  organizationHeadNouns: string[]
  // Verbs whose postnominal adjective predicates the OBJECT (`achou a casa
  // VAZIA`, `left the door OPEN`).
  objectPredicativeVerbs: string[]
  // Aktionsart: the verb's lexical aspect class, refining the timeline
  // (a state has no culmination, an achievement is instantaneous).
  verbClasses: VerbClassHint[]
  // Fragment particles: a verbless `NP + também/não` sentence copies the
  // previous verb (`Eu também.`, `Daniela não.`).
  fragmentParticles: string[]
  // Focus particles associating with the constituent to their right
  // (`ATÉ Rei chorou`, `only Daniela knew`).
  focusParticles: string[]
  // Month names, for the calendar anchors the timeline extracts.
  monthNames: string[]
  // The meronymy table: declared part-whole pairs bridging reference reads
  // (`o carro ... O MOTOR` — the engine belongs to the car on stage).
  // Compile-time world knowledge, reviewed and frozen like every other list.
  meronymy: MeronymyPair[]
  verbFeats: VerbFeatMarks
}

export type MeronymyPair = {
  whole: string
  part: string
}

export type VerbClassHint = {
  lemma: string
  class: "state" | "activity" | "achievement" | "accomplishment"
}

// Which sense a verb feat carries on the timeline, first declared prefix
// wins; none for a feat outside the declared vocabulary.
export function verbTense(feat: string, marks: VerbFeatMarks): Optional<string> {
  for (const { prefix, sense } of marks.tenseSenses) {
    switch (feat.startsWith(prefix)) {
      case true:
        return { kind: "some", value: sense }
      case false:
        continue
    }
  }

  return { kind: "none" }
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
