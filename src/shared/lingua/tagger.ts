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
import type { ClosedClass, Entry, Pos, SuffixRule, SyntaxData, VerbFeatMarks } from "./model"
import type { SourceToken } from "./lexer"

export type Provenance =
  | "lexicon"
  // The pick fell through every evidence-backed rule to the bare priority
  // order while the candidates spanned several parts of speech: a
  // load-bearing GUESS, marked so downstream passes and diagnostics can
  // treat it conservatively.
  | "contested"
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

// `boundary` records clause punctuation (comma, dash, terminal — quotes are
// typesetting and stay transparent) between that content token and the
// current one: bigram rules that model SUBJECT-VERB adjacency must not fire
// across it (`por S, coisa` — S is not coisa's clause-mate subject).
// `lemma` lets the periphrasis rules check WHO the previous verb is: a
// participle/gerund only chains onto an auxiliary (foi comido, tinha visto,
// was running), never onto a plain lexical verb (`vanished wept` is two
// finite clauses, not a perfect).
type PrevPos = { kind: "none" } | { kind: "pos"; pos: Pos; feat: string; boundary: boolean; lemma: string }

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
  let afterOpeningQuote = false

  for (const token of input.tokens) {
    switch (token.kind) {
      case "punctuation":
        out.push({ role: "punctuation", token })
        // A quoted title opens like a sentence opens: `li "Um estudo..."`
        // must casefold `Um` back to the article, exactly as at a sentence
        // start.
        afterOpeningQuote = isOpeningQuote(token.text)
        switch (prev.kind) {
          case "none":
            break
          case "pos":
            switch (isQuoteMark(token.text)) {
              case true:
                break
              case false:
                prev = { kind: "pos", pos: prev.pos, feat: prev.feat, boundary: true, lemma: prev.lemma }
                break
            }
            break
        }
        break
      case "number": {
        const tagged: TaggedToken = { token, lemma: token.text, pos: "NUM", feat: "", provenance: "shape-guess" }
        out.push({ role: "content", tagged })
        prev = { kind: "pos", pos: "NUM", feat: "", boundary: false, lemma: token.text }
        seenContent = true
        afterOpeningQuote = false
        break
      }
      case "word": {
        const tagged = tagWord(token, seenContent === false || afterOpeningQuote, prev, input, closed)
        out.push({ role: "content", tagged })
        prev = { kind: "pos", pos: tagged.pos, feat: tagged.feat, boundary: false, lemma: tagged.lemma }
        seenContent = true
        afterOpeningQuote = false
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

function isOpeningQuote(text: string): boolean {
  switch (text) {
    case "“":
      return true
    case "«":
      return true
    case "\"":
      return true
    case "‘":
      return true
    default:
      return false
  }
}

// Quote marks typeset, they don't segment: only every OTHER mark is a clause
// boundary for the bigram window.
function isQuoteMark(text: string): boolean {
  switch (text) {
    case "“":
      return true
    case "”":
      return true
    case "\"":
      return true
    case "‘":
      return true
    case "’":
      return true
    case "«":
      return true
    case "»":
      return true
    default:
      return false
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

  const lowercaseAllowed = isCapitalized(token.text) === false || initial

  switch (initial && isCapitalized(token.text)) {
    case true: {
      const folded = input.lexicon.lookup(lower, input.scope)

      switch (folded.length > 0) {
        case true:
          return folded
        case false:
          break
      }
      break
    }
    case false:
      break
  }

  // The pre-reform orthography bridge: AO90 deleted exactly three accent
  // classes — ói/éi diphthongs (heróico→heroico, idéia→ideia), ôo/êe
  // (vôo→voo, vêem→veem) and the trema (lingüiça→linguiça). An unknown word
  // written the old way retags as its modern entry; the lemma then carries
  // the modern spelling, which is the disclosure. Mid-sentence capitalized
  // words keep their PROPN path — the bridge never lowercases what the
  // casefold rule wouldn't.
  switch (lowercaseAllowed) {
    case false:
      return exact
    case true:
      break
  }

  const reform = reformSpelling(lower)

  switch (reform.kind) {
    case "none":
      return exact
    case "some":
      return input.lexicon.lookup(reform.value, input.scope)
  }
}

function reformSpelling(lower: string): Optional<string> {
  const modern = lower
    .replace(/ü/g, "u")
    .replace(/ói/g, "oi")
    .replace(/éi/g, "ei")
    .replace(/ôo/g, "oo")
    .replace(/êe/g, "ee")

  switch (modern === lower) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: modern }
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

  return entryTag(token, chosen.entry, chosen.contested ? "contested" : "lexicon")
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

  // The capital letter outranks the suffix table — a mid-sentence
  // capitalized unknown is a NAME even when its tail looks derivational
  // (`B Bar` must not read Bar as an -ar verb) — EXCEPT when the suffix
  // says adjective: names legitimately embed capitalized adjectives
  // (`Pavilhão Dourado`, `Mar Morto`), and the ADJ reading keeps the name's
  // head on its noun.
  const nameish =
    initial === false &&
    isCapitalized(token.text) &&
    (suffix.kind === "none" || suffix.value !== "ADJ")

  switch (nameish) {
    case true:
      return { token, lemma: token.text, pos: "PROPN", feat: "", provenance: "shape-guess" }
    case false:
      break
  }

  switch (suffix.kind) {
    case "some":
      return { token, lemma: lower, pos: suffix.value, feat: "", provenance: "suffix-guess" }
    case "none":
      return { token, lemma: lower, pos: "NOUN", feat: "", provenance: "default" }
  }
}

function entryTag(token: SourceToken, entry: Entry, provenance: Provenance): TaggedToken {
  return { token, lemma: entry.lemma, pos: entry.pos, feat: entry.feat, provenance }
}

type FormClass = "any" | "finite" | "infinitive" | "participle" | "gerund"

type Person = "any" | "third"

// "marked" admits only candidates carrying morphology (a non-empty feat):
// the postnominal-adjective rule wants DELAF's agreement-inflected adjectives
// (`vazio` ms), never English's featless junk ADJ readings (`brother`).
type FeatDemand = "any" | "marked"

// "clause-mate" demands no clause punctuation between neighbour and word:
// the nominal-subject-governs-finite-verb rules model SUBJECT VERB adjacency,
// and across a comma the nominal is another clause's material (`estima por
// S, coisa...` must not read `coisa` as a verb S governs). Every other rule
// keeps firing across marks ("any") — adverb chains and adjective lists
// legitimately ride commas.
type BondDemand = "any" | "clause-mate"

type ContextRule = {
  prev: Pos
  prefer: Pos
  form: FormClass
  person: Person
  feat: FeatDemand
  bond: BondDemand
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
  { prev: "DET", prefer: "NOUN", form: "any", person: "any", feat: "any", bond: "any" },
  { prev: "ADP", prefer: "VERB", form: "infinitive", person: "any", feat: "any", bond: "any" },
  { prev: "ADP", prefer: "NOUN", form: "any", person: "any", feat: "any", bond: "any" },
  { prev: "PRON", prefer: "VERB", form: "infinitive", person: "any", feat: "any", bond: "any" },
  // person "third": after an enclitic (`Vendem-se CASAS`) the next word is
  // NOT the pronoun's verb, and the junk 2nd-person homograph (casar P2s)
  // must not win; genuine 1st-person verbs after `eu` resolve through the
  // valency-hinted priority pick instead.
  { prev: "PRON", prefer: "VERB", form: "any", person: "third", feat: "any", bond: "clause-mate" },
  { prev: "NOUN", prefer: "VERB", form: "finite", person: "third", feat: "any", bond: "clause-mate" },
  { prev: "NOUN", prefer: "ADJ", form: "any", person: "any", feat: "marked", bond: "any" },
  { prev: "PROPN", prefer: "VERB", form: "finite", person: "third", feat: "any", bond: "clause-mate" },
  { prev: "VERB", prefer: "VERB", form: "infinitive", person: "any", feat: "any", bond: "any" },
  { prev: "AUX", prefer: "VERB", form: "infinitive", person: "any", feat: "any", bond: "any" },
  { prev: "VERB", prefer: "VERB", form: "participle", person: "any", feat: "any", bond: "any" },
  { prev: "AUX", prefer: "VERB", form: "participle", person: "any", feat: "any", bond: "any" },
  // The progressive periphrasis: `was RUNNING` must beat the -ing noun.
  { prev: "VERB", prefer: "VERB", form: "gerund", person: "any", feat: "any", bond: "any" },
  { prev: "AUX", prefer: "VERB", form: "gerund", person: "any", feat: "any", bond: "any" },
  { prev: "VERB", prefer: "ADV", form: "any", person: "any", feat: "any", bond: "any" },
  { prev: "ADV", prefer: "ADV", form: "any", person: "any", feat: "any", bond: "any" },
  { prev: "ADV", prefer: "VERB", form: "any", person: "any", feat: "any", bond: "any" },
  // A degree/manner adverb grades an adjective (`mais ALTA`, `tão calmo`) —
  // after the verb reading fails, the marked-ADJ reading beats the bare-noun
  // priority (alta the noun would otherwise win).
  { prev: "ADV", prefer: "ADJ", form: "any", person: "any", feat: "marked", bond: "any" },
]

type Picked = { entry: Entry; contested: boolean }

function disambiguate(candidates: readonly Entry[], prev: PrevPos, syntax: SyntaxData): Picked {
  switch (prev.kind) {
    case "none":
      return priorityPick(candidates, syntax)
    case "pos":
      break
  }

  const agreeing = agreementPick(candidates, prev, syntax)

  switch (agreeing.kind) {
    case "some":
      return { entry: agreeing.value, contested: false }
    case "none":
      break
  }

  // A degree word grades what follows: after `muito`/`mais`/`tão`/`very` a
  // MARKED adjective outranks both the verb homograph (fraca -> fracar) and
  // the junk adverb reading (alto -> loudly).
  const degreeBefore =
    prev.pos === "ADV" &&
    (syntax.intensifiers.includes(prev.lemma) || syntax.degreeAdverbs.includes(prev.lemma))

  switch (degreeBefore) {
    case true: {
      const adjectives = candidates.filter((e) => e.pos === "ADJ" && e.feat.length > 0)

      switch (adjectives.length > 0) {
        case true:
          return { entry: lemmaPick(adjectives, syntax), contested: false }
        case false:
          break
      }
      break
    }
    case false:
      break
  }

  // After a modal (`could LEAVE`) or an infinitive marker (`to LEAVE`) the
  // BARE verb reading beats the noun priority. Only English has featless
  // bare verbs, so these gates are inert in Portuguese by construction.
  const bareVerbBefore =
    (prev.pos === "VERB" && syntax.modalVerbs.includes(prev.lemma)) ||
    (prev.pos === "ADP" && syntax.purposeMarkers.includes(prev.lemma))

  switch (bareVerbBefore) {
    case true: {
      const bare = candidates.filter((e) => e.pos === "VERB" && e.feat === "")

      switch (bare.length > 0) {
        case true:
          return { entry: lemmaPick(bare, syntax), contested: false }
        case false:
          break
      }
      break
    }
    case false:
      break
  }

  for (const rule of CONTEXT_RULES) {
    switch (rule.prev === prev.pos) {
      case false:
        continue
      case true:
        break
    }

    switch (rule.bond === "clause-mate" && prev.boundary) {
      case true:
        continue
      case false:
        break
    }

    // A participle/gerund chains only onto an AUXILIARY: after a plain
    // lexical verb (`vanished wept`) the periphrasis reading is junk and the
    // word keeps its finite reading. AUX-tagged neighbours pass unexamined.
    const periphrastic =
      (rule.form === "participle" || rule.form === "gerund") &&
      prev.pos === "VERB" &&
      syntax.passiveAuxiliaries.includes(prev.lemma) === false &&
      syntax.perfectAuxiliaries.includes(prev.lemma) === false

    switch (periphrastic) {
      case true:
        continue
      case false:
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
        return { entry: lemmaPick(matches, syntax), contested: false }
    }
  }

  return priorityPick(candidates, syntax)
}

// The agreement gate, the rule that keeps `luz baixa`, `certa estima` and
// `poço seco` nominal: after a gender/number-marked NOUN or ADJ, a nominal
// candidate AGREEING with it (identical fs/ms/fp/mp feat) beats a junk-rare
// finite-verb homograph (baixar, estimar, secar) — unless some finite verb
// candidate is valency-curated (ser: `a beleza era` must stay verbal). The
// gate is data-inert in English: its feats never match the agreement shape.
const AGREEMENT = /^[mf][sp]$/

function agreementPick(
  candidates: readonly Entry[],
  prev: { pos: Pos; feat: string },
  syntax: SyntaxData,
): Optional<Entry> {
  const host = prev.pos === "NOUN" || prev.pos === "ADJ"

  switch (host && AGREEMENT.test(prev.feat)) {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const hintedVerb = candidates.some(
    (e) =>
      e.pos === "VERB" &&
      hasPrefix(e.feat, syntax.verbFeats.finitePrefixes) &&
      syntax.valency.some((v) => v.lemma === e.lemma),
  )

  switch (hintedVerb) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const adjective = candidates.find((e) => e.pos === "ADJ" && e.feat === prev.feat)

  switch (adjective === undefined) {
    case false:
      return { kind: "some", value: adjective! }
    case true:
      break
  }

  const noun = candidates.find((e) => e.pos === "NOUN" && e.feat === prev.feat)

  switch (noun === undefined) {
    case false:
      return { kind: "some", value: noun! }
    case true:
      return { kind: "none" }
  }
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
    case "gerund":
      return hasPrefix(feat, marks.gerundPrefixes)
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

// Among equally-preferred candidates, one whose lemma carries a valency hint
// is a word the syntax data marks as central (`era` resolves to ser, not the
// rare erar), so it wins. When SEVERAL hinted lemmas share the form — foi is
// both ser and ir — the GRAMMATICALIZED copula takes it: `Foi um tempo`
// predicates, `a cidade foi tomada` passivizes, and dataflow's impersonal
// excusal sees the copula it expects. The preference is gated on the
// passive-auxiliary list, NOT the copular frame alone — virar is copular but
// `viram` must stay ver, not turn.
function lemmaPick(matches: readonly Entry[], syntax: SyntaxData): Entry {
  const auxCopula = matches.find((e) => syntax.passiveAuxiliaries.includes(e.lemma) &&
    syntax.valency.some((v) => v.lemma === e.lemma && v.frame === "copular"))

  switch (auxCopula === undefined) {
    case false:
      return auxCopula!
    case true:
      break
  }

  const known = matches.find((e) => syntax.valency.some((v) => v.lemma === e.lemma))

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
function priorityPick(candidates: readonly Entry[], syntax: SyntaxData): Picked {
  const hinted = candidates.filter(
    (e) =>
      e.pos === "VERB" &&
      hasPrefix(e.feat, syntax.verbFeats.finitePrefixes) &&
      syntax.valency.some((v) => v.lemma === e.lemma),
  )

  switch (hinted.length > 0) {
    case true:
      return { entry: lemmaPick(hinted, syntax), contested: false }
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

  // Several parts of speech survived every rule: the winner is priority
  // order alone, a guess worth flagging.
  const classes = new Set(candidates.map((e) => e.pos))

  return { entry: best, contested: classes.size >= 2 }
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
