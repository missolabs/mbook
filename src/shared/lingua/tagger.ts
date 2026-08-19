// The tagger — token classification against the compiled symbol table. Each
// word token is looked up in the lexicon and resolved to a single
// {lemma, pos, feat}, plus a provenance marker recording how the choice was
// made, so later graph work can weigh its confidence:
//   * "lexicon"      — the dictionary offered candidates and a rule picked one;
//   * "closed-class" — a determiner/pronoun/preposition/conjunction (or an
//                      English clitic) is a deterministic function-word winner;
//   * "suffix-guess" — an unknown word matched a derivational suffix rule;
//   * "shape-guess"  — inferred from surface shape (a mid-sentence capitalized
//                      unknown is a proper noun; digits are a number);
//   * "default"      — nothing else fired, so it is a common noun.
//
// Disambiguation among lexicon candidates is a table-driven decision
// procedure, not a trained model — the same shape as a parser's precedence
// table: closed-class membership is decisive; otherwise the first matching
// left-context bigram rule wins (CONTEXT_RULES, tried in authored order), and
// with no context a fixed content-first priority breaks the tie. The rules
// that prefer a VERB reading after a nominal or another verb are gated on the
// candidate's verb-form class (finite / infinitive / participle), read from
// the dictionary's own VerbFeatMarks — the rule engine stays language-blind
// and the language data says which morphology codes mean what.

import type { Optional } from "../optional"
import type { Lexicon, VariantScope } from "./lexicon"
import type { ClosedClass, Entry, Pos, SuffixRule, SyntaxData, ValencyHint, VerbFeatMarks } from "./model"
import type { SourceToken } from "./lexer"

export type Provenance =
  | "lexicon"
  | "closed-class"
  | "suffix-guess"
  | "shape-guess"
  | "default"

export type TaggedToken = {
  token: SourceToken
  lemma: string
  pos: Pos
  feat: string
  provenance: Provenance
}

export type AnalyzedToken =
  | { role: "content"; tagged: TaggedToken }
  | { role: "punctuation"; token: SourceToken }

export type TagInput = {
  tokens: readonly SourceToken[]
  lexicon: Lexicon
  scope: VariantScope
  syntax: SyntaxData
}

type PrevPos = { kind: "none" } | { kind: "pos"; pos: Pos }

type Closed = {
  det: Set<string>
  pron: Set<string>
  prep: Set<string>
  conj: Set<string>
  adv: Set<string>
}

export function tagSentence(input: TagInput): readonly AnalyzedToken[] {
  const closed = indexClosedClass(input.syntax.closedClass)

  const out: AnalyzedToken[] = []
  let prev: PrevPos = { kind: "none" }
  let seenContent = false

  for (const token of input.tokens) {
    switch (token.kind) {
      case "punctuation":
        out.push({ role: "punctuation", token })
        break
      case "number": {
        const tagged: TaggedToken = { token, lemma: token.text, pos: "NUM", feat: "", provenance: "shape-guess" }
        out.push({ role: "content", tagged })
        prev = { kind: "pos", pos: "NUM" }
        seenContent = true
        break
      }
      case "word": {
        const tagged = tagWord(token, seenContent === false, prev, input, closed)
        out.push({ role: "content", tagged })
        prev = { kind: "pos", pos: tagged.pos }
        seenContent = true
        break
      }
    }
  }

  retagPossessives(out)

  return out
}

// The English clitic table reads every `'s` as the auxiliary (the honest
// left-to-right choice), but once the whole sentence is tagged a `'s` sitting
// directly before a nominal is the possessive marker (`the cat's tail`), not
// `is`. A `'s` before anything else (`it's grey`, `she's leaving`) keeps the
// auxiliary reading.
function retagPossessives(out: AnalyzedToken[]): void {
  for (let i = 0; i < out.length - 1; i++) {
    const current = out[i]!

    switch (current.role) {
      case "punctuation":
        continue
      case "content":
        break
    }

    const norm = current.tagged.token.text.replace(/’/g, "'").toLowerCase()

    switch (current.tagged.pos === "AUX" && norm === "'s" && isNominal(out[i + 1]!)) {
      case false:
        continue
      case true:
        break
    }

    out[i] = {
      role: "content",
      tagged: {
        token: current.tagged.token,
        lemma: "'s",
        pos: "PART",
        feat: "Poss",
        provenance: "closed-class",
      },
    }
  }
}

function isNominal(token: AnalyzedToken): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return token.tagged.pos === "NOUN" || token.tagged.pos === "PROPN"
  }
}

function tagWord(
  token: SourceToken,
  initial: boolean,
  prev: PrevPos,
  input: TagInput,
  closed: Closed,
): TaggedToken {
  const clitic = cliticTag(token)

  switch (clitic.kind) {
    case "some":
      return clitic.value
    case "none":
      break
  }

  const lower = token.text.toLowerCase()
  const candidates = candidatesFor(token, initial, lower, input)

  switch (candidates.length === 0) {
    case true:
      return unknownTag(token, initial, lower, input.syntax.suffixGuess)
    case false:
      return knownTag(token, lower, candidates, prev, input.syntax, closed)
  }
}

// Exact form first; only when it misses AND the word is a sentence-initial
// capitalized word do we retry casefolded — "Casa" at a sentence start is the
// common noun "casa", but a mid-sentence "Casa" is left to the PROPN heuristic.
function candidatesFor(
  token: SourceToken,
  initial: boolean,
  lower: string,
  input: TagInput,
): readonly Entry[] {
  const exact = input.lexicon.lookup(token.text, input.scope)

  switch (exact.length > 0) {
    case true:
      return exact
    case false:
      break
  }

  switch (initial && isCapitalized(token.text)) {
    case true:
      return input.lexicon.lookup(lower, input.scope)
    case false:
      return exact
  }
}

function knownTag(
  token: SourceToken,
  lower: string,
  candidates: readonly Entry[],
  prev: PrevPos,
  syntax: SyntaxData,
  closed: Closed,
): TaggedToken {
  const forced = closedClassPos(lower, closed)

  switch (forced.kind) {
    case "some":
      return forcedTag(token, lower, candidates, forced.value)
    case "none":
      break
  }

  const chosen = disambiguate(candidates, prev, syntax)

  return entryTag(token, chosen, "lexicon")
}

function forcedTag(
  token: SourceToken,
  lower: string,
  candidates: readonly Entry[],
  pos: Pos,
): TaggedToken {
  const hit = candidates.find((e) => e.pos === pos)

  switch (hit === undefined) {
    case false:
      return entryTag(token, hit!, "closed-class")
    case true:
      return { token, lemma: lower, pos, feat: "", provenance: "closed-class" }
  }
}

function unknownTag(
  token: SourceToken,
  initial: boolean,
  lower: string,
  rules: readonly SuffixRule[],
): TaggedToken {
  const suffix = suffixGuess(lower, rules)

  switch (suffix.kind) {
    case "some":
      return { token, lemma: lower, pos: suffix.value, feat: "", provenance: "suffix-guess" }
    case "none":
      break
  }

  switch (initial === false && isCapitalized(token.text)) {
    case true:
      return { token, lemma: token.text, pos: "PROPN", feat: "", provenance: "shape-guess" }
    case false:
      return { token, lemma: lower, pos: "NOUN", feat: "", provenance: "default" }
  }
}

function entryTag(token: SourceToken, entry: Entry, provenance: Provenance): TaggedToken {
  return { token, lemma: entry.lemma, pos: entry.pos, feat: entry.feat, provenance }
}

type FormClass = "any" | "finite" | "infinitive" | "participle"

type Person = "any" | "third"

// "marked" admits only candidates carrying morphology (a non-empty feat):
// the postnominal-adjective rule wants DELAF's agreement-inflected adjectives
// (`vazio` ms), never English's featless junk ADJ readings (`brother`).
type FeatDemand = "any" | "marked"

type ContextRule = {
  prev: Pos
  prefer: Pos
  form: FormClass
  person: Person
  feat: FeatDemand
}

// The contextual bigram rules, tried top-down among those matching the
// left-neighbour POS — the first rule some candidate satisfies wins, so a
// later rule for the same neighbour is an ordered fallback. A determiner or
// preposition first tries a marked INFINITIVE (`sem mover`, `para ver` — the
// infinitive/future-subjunctive homograph must not read as subjunctive) and
// only then makes an ambiguous word its NOUN head/object; a pronoun likewise
// tries the infinitive (the clitic shape `se despedir`) before the plain
// VERB; a nominal subject makes a FINITE verb reading win (`a beleza
// era` -> ser, while `the kitchen sink` stays a noun because base-form `sink`
// is not finite) — but only a THIRD-PERSON-compatible one: a noun subject
// cannot govern `vazio` (vaziar, P1s), so `o caderno vazio` falls through to
// the new postnominal-ADJ rule instead of inventing a first-person verb.
// A verb or auxiliary chains onto an INFINITIVE (`veio ver`), which never
// flips a bare-object noun since those readings are not infinitive-marked,
// and failing that onto a PARTICIPLE — the passive and perfect periphrases
// (`foi comido`, `tinha visto`, `was eaten`, `had seen`). Failing both
// chains, a post-verbal word with an ADV reading is adverbial (`comeu assim`,
// `existe mesmo`) — a real bare-noun object (`comeu peixe`) has no ADV
// reading and never reaches the rule — and an adverb chains a following
// ADV-capable word into the locution (`assim mesmo`, `mesmo aí`), or failing
// that reveals a negated/adverb-fronted verb (`não sabia`, `did not see` —
// `see` would otherwise fall to its noun reading).
const CONTEXT_RULES: readonly ContextRule[] = [
  { prev: "DET", prefer: "NOUN", form: "any", person: "any", feat: "any" },
  { prev: "ADP", prefer: "VERB", form: "infinitive", person: "any", feat: "any" },
  { prev: "ADP", prefer: "NOUN", form: "any", person: "any", feat: "any" },
  { prev: "PRON", prefer: "VERB", form: "infinitive", person: "any", feat: "any" },
  { prev: "PRON", prefer: "VERB", form: "any", person: "any", feat: "any" },
  { prev: "NOUN", prefer: "VERB", form: "finite", person: "third", feat: "any" },
  { prev: "NOUN", prefer: "ADJ", form: "any", person: "any", feat: "marked" },
  { prev: "PROPN", prefer: "VERB", form: "finite", person: "third", feat: "any" },
  { prev: "VERB", prefer: "VERB", form: "infinitive", person: "any", feat: "any" },
  { prev: "AUX", prefer: "VERB", form: "infinitive", person: "any", feat: "any" },
  { prev: "VERB", prefer: "VERB", form: "participle", person: "any", feat: "any" },
  { prev: "AUX", prefer: "VERB", form: "participle", person: "any", feat: "any" },
  { prev: "VERB", prefer: "ADV", form: "any", person: "any", feat: "any" },
  { prev: "ADV", prefer: "ADV", form: "any", person: "any", feat: "any" },
  { prev: "ADV", prefer: "VERB", form: "any", person: "any", feat: "any" },
]

function disambiguate(candidates: readonly Entry[], prev: PrevPos, syntax: SyntaxData): Entry {
  switch (prev.kind) {
    case "none":
      return priorityPick(candidates, syntax)
    case "pos":
      break
  }

  for (const rule of CONTEXT_RULES) {
    switch (rule.prev === prev.pos) {
      case false:
        continue
      case true:
        break
    }

    const matches = candidates.filter(
      (e) =>
        e.pos === rule.prefer &&
        formMatches(rule.form, e.feat, syntax.verbFeats) &&
        personMatches(rule.person, e.feat) &&
        featMatches(rule.feat, e.feat),
    )

    switch (matches.length === 0) {
      case true:
        continue
      case false:
        return lemmaPick(matches, syntax.valency)
    }
  }

  return priorityPick(candidates, syntax)
}

function formMatches(form: FormClass, feat: string, marks: VerbFeatMarks): boolean {
  switch (form) {
    case "any":
      return true
    case "finite":
      return hasPrefix(feat, marks.finitePrefixes)
    case "infinitive":
      return hasPrefix(feat, marks.infinitivePrefixes)
    case "participle":
      return hasPrefix(feat, marks.participlePrefixes)
  }
}

function hasPrefix(feat: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => feat.startsWith(prefix))
}

// Third-person compatibility, read off the feat's own person digits: a code
// naming only 1st/2nd person (DELAF `P1s`, `Y2s`) cannot follow a nominal
// subject; a code with a `3` or with no person digit at all (English `PAST`,
// `FIN`) is compatible.
function featMatches(demand: FeatDemand, feat: string): boolean {
  switch (demand) {
    case "any":
      return true
    case "marked":
      return feat.length > 0
  }
}

function personMatches(person: Person, feat: string): boolean {
  switch (person) {
    case "any":
      return true
    case "third":
      return feat.includes("3") || /[12]/.test(feat) === false
  }
}

// Among equally-preferred candidates, one whose lemma carries a valency hint is
// a word the syntax data marks as central (`era` resolves to ser, not the rare
// erar), so it wins; otherwise the first candidate stands.
function lemmaPick(matches: readonly Entry[], valency: readonly ValencyHint[]): Entry {
  const known = matches.find((e) => valency.some((v) => v.lemma === e.lemma))

  switch (known === undefined) {
    case true:
      return matches[0]!
    case false:
      return known!
  }
}

const PRIORITY: readonly Pos[] = [
  "NOUN",
  "PROPN",
  "VERB",
  "ADJ",
  "ADV",
  "NUM",
  "DET",
  "PRON",
  "ADP",
  "AUX",
  "CONJ",
  "PART",
  "INTJ",
  "X",
]

// With no usable left context, a FINITE verb reading whose lemma the valency
// data curates beats the noun-first priority: pro-drop Portuguese opens
// clauses on the verb (`Olho para o mar`) and English fronts its copula in
// questions (`Was it a dream?`). The hint gate keeps this surgical — an
// uncurated homograph (`Casa é boa`) still reads as the noun.
function priorityPick(candidates: readonly Entry[], syntax: SyntaxData): Entry {
  const hinted = candidates.filter(
    (e) =>
      e.pos === "VERB" &&
      hasPrefix(e.feat, syntax.verbFeats.finitePrefixes) &&
      syntax.valency.some((v) => v.lemma === e.lemma),
  )

  switch (hinted.length > 0) {
    case true:
      return lemmaPick(hinted, syntax.valency)
    case false:
      break
  }

  let best = candidates[0]!
  let bestRank = PRIORITY.indexOf(best.pos)

  for (const entry of candidates) {
    const rank = PRIORITY.indexOf(entry.pos)

    switch (rank < bestRank) {
      case true:
        best = entry
        bestRank = rank
        break
      case false:
        break
    }
  }

  return best
}

function closedClassPos(lower: string, closed: Closed): Optional<Pos> {
  const hits: Pos[] = []

  addIf(closed.det.has(lower), hits, "DET")
  addIf(closed.pron.has(lower), hits, "PRON")
  addIf(closed.prep.has(lower), hits, "ADP")
  addIf(closed.conj.has(lower), hits, "CONJ")
  addIf(closed.adv.has(lower), hits, "ADV")

  switch (hits.length === 1) {
    case true:
      return { kind: "some", value: hits[0]! }
    case false:
      return { kind: "none" }
  }
}

function addIf(present: boolean, hits: Pos[], pos: Pos): void {
  switch (present) {
    case true:
      hits.push(pos)
      return
    case false:
      return
  }
}

// Longest matching derivational suffix wins, so `estável` reads as `ável` (ADJ),
// not the shorter `al` it also ends with.
function suffixGuess(lower: string, rules: readonly SuffixRule[]): Optional<Pos> {
  let bestLen = 0
  let best: Optional<Pos> = { kind: "none" }

  for (const rule of rules) {
    const matches = lower.endsWith(rule.suffix) && rule.suffix.length > bestLen

    switch (matches) {
      case true:
        bestLen = rule.suffix.length
        best = { kind: "some", value: rule.pos }
        break
      case false:
        break
    }
  }

  return best
}

type Clitic = { kind: "none" } | { kind: "some"; value: TaggedToken }

// The English clitic pieces the lexer split off. The lexicon has none of
// them, so this closed table is their only tagger. `'s` and `'d` are genuinely
// ambiguous (is/has, would/had); we take the commoner auxiliary reading and
// record it — a documented compromise, not a lookup failure.
function cliticTag(token: SourceToken): Clitic {
  const norm = token.text.replace(/’/g, "'").toLowerCase()

  switch (norm) {
    case "n't":
      return some(token, "not", "PART", "Polarity=Neg")
    case "'s":
      return some(token, "be", "AUX", "")
    case "'re":
      return some(token, "be", "AUX", "")
    case "'m":
      return some(token, "be", "AUX", "")
    case "'ve":
      return some(token, "have", "AUX", "")
    case "'ll":
      return some(token, "will", "AUX", "")
    case "'d":
      return some(token, "would", "AUX", "")
    default:
      return { kind: "none" }
  }
}

function some(token: SourceToken, lemma: string, pos: Pos, feat: string): Clitic {
  return { kind: "some", value: { token, lemma, pos, feat, provenance: "closed-class" } }
}

function indexClosedClass(cc: ClosedClass): Closed {
  return {
    det: new Set(cc.determiners),
    pron: new Set(cc.pronouns),
    prep: new Set(cc.prepositions),
    conj: new Set(cc.conjunctions),
    adv: new Set(cc.adverbs),
  }
}

function isCapitalized(text: string): boolean {
  const first = text[0]

  switch (first === undefined) {
    case true:
      return false
    case false:
      return first! !== first!.toLowerCase()
  }
}
