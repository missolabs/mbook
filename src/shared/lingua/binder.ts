// The binder — semantic analysis over one sentence's phrases. Where a
// compiler's binder resolves names to declarations, this one resolves phrases
// to ROLES: subject-of, object-of, complement-of, modifier-of, predicate-of,
// agent-of and located-in. Authored declarations outrank inference — a
// resolved `@[Name]` mention PINS its NP as subject before any heuristic
// runs. The pass itself is clause-level and positional — both supported
// languages are SVO, so one engine with no per-language parameters covers
// them — refined by data-driven gates from SyntaxData:
//   * verb valency: a verb whose lemma is marked intransitive, copular or
//     prepositional takes no direct object, so a positionally-adjacent NP after
//     it is not made its object;
//   * complementizers: after an object-admitting verb, the declared
//     complementizer word (`que` / `that`) opens a clausal complement;
//   * verb-form marks: a VP headed by a morphologically-marked infinitive
//     chains onto the nearest preceding VP as its complement;
//   * a resolved subject-mention glyph: an author's `@[Name]` sitting inside an
//     NP pins that NP as the subject of its clause's verb, overriding the
//     positional "nearest NP before the verb" guess. Pinned relations are marked
//     so the pin is distinguishable from the heuristic.
//
// Comma-bounded parenthetical stretches between a VP and its right-hand
// material are hopped over, so `compreendeu, aos dezessete anos, que...` still
// finds what the verb takes.
//
// Dependent and head are token indices into the sentence's `tokens` array (chunk
// heads, or the modifier token itself), the same coordinate the parser and
// glyph anchors use. A complement-of's dependent is the LEFTMOST token of the
// complement — the complementizer for a clausal complement, the infinitive verb
// itself for an infinitival chain. That token always exists when the relation
// fires and marks the complement's left edge exactly, so its span is
// [dependent, sentence end) without pretending the embedded predicate was
// found; the embedded clause's own VP still earns its own subject/object
// relations.

import type { Chunk } from "./parser"
import type { AnalyzedToken } from "./tagger"
import type { SyntaxData, ValencyFrame, ValencyHint, VerbFeatMarks } from "./model"
import { verbTense } from "./model"
import type { Optional } from "../optional"

export type RelationKind =
  | "subject-of"
  | "object-of"
  | "complement-of"
  | "modifier-of"
  | "predicate-of"
  | "agent-of"
  | "located-in"
  | "oblique-of" // a prepositional-frame verb's governed PP argument (gostar DE, think OF)
  | "dative-of" // a ditransitive's recipient (deu o livro A MARIA, gave the book TO MARY)
  | "particle-of" // a verb-particle unit's particle (gave UP)
  | "vocative-of" // an addressed name, outside the clause's argument structure (Daniela, acho...)
  | "appositive-of" // a comma-bound renaming NP (Daniela, UMA MULHER que conheci)
  | "compared-to" // the standard of a comparative (mais alto QUE DANIELA)
  | "temporal-of" // a time-naming adjunct (NAQUELA NOITE, li)
  | "reflexive-of" // the reflexive/reciprocal/impersonal clitic riding its verb (abraçaram-SE)
  | "adverbial-of" // an adverbial subordinate clause's subordinator, bound to the matrix verb
  | "light-verb-of" // verb+noun denoting ONE event (deu um PASSEIO = passear); pair resolved in syntax data
  | "advmod-of" // an adverb bound to the verb it modifies (correu DESESPERADAMENTE; wh-adjuncts: ONDE mora?)
  | "degree-of" // an intensifier/degree word grading its adjective (MUITO alto, MAIS alto)
  | "predicative-of" // an object predicative (achou a casa VAZIA — vazia predicates casa)
  | "role-of" // the como/as role predicate (trabalhava como DETETIVE)
  | "purpose-of" // a purpose infinitive bound to its matrix (saiu para COMPRAR pão)
  | "duration-of" // a duration adjunct (POR DOIS ANOS), distinct from point-in-time temporal-of

export type RelationProvenance = "heuristic" | "pinned"

// Whether the clause the relation lives in is asserted or denied: a declared
// negator riding the verb (`não era`, `did not see`, `nunca mais voltou`)
// flips every relation headed by that verb — and, through complement chains,
// by its chained participle/infinitive.
export type Polarity = "affirmative" | "negative"

export type Relation = {
  kind: RelationKind
  dependent: number
  head: number
  provenance: RelationProvenance
  polarity: Polarity
}

// A resolved subject-mention's covered token indices in this sentence.
export type SubjectPin = { tokens: readonly number[] }

export type RelationInput = {
  tokens: readonly AnalyzedToken[]
  chunks: readonly Chunk[]
  pins: readonly SubjectPin[]
  syntax: SyntaxData
}

export function bind(input: RelationInput): readonly Relation[] {
  const pinnedSubjects = resolvePins(input.chunks, input.pins)

  const relations: Relation[] = []

  input.chunks.forEach((chunk, ci) => {
    switch (chunk.kind) {
      case "VP":
        addSubject(relations, input, ci, pinnedSubjects)
        addQuotativeInversion(relations, input, ci, pinnedSubjects)
        addSePassive(relations, input, ci, pinnedSubjects)
        addCliticArguments(relations, input, ci)
        addBareProclitic(relations, input, ci)
        addComplementOrObject(relations, input, ci, pinnedSubjects)
        addRelativeObject(relations, input, ci)
        addPiedPipedRelative(relations, input, ci)
        addLightVerb(relations, input, ci)
        addPredicate(relations, input, ci, pinnedSubjects)
        addPresentationalSubject(relations, input, ci, pinnedSubjects)
        addInfinitiveChain(relations, input, ci)
        addParticipleChain(relations, input, ci)
        addGerundChain(relations, input, ci)
        addModalChain(relations, input, ci)
        addParticle(relations, input, ci)
        addOblique(relations, input, ci)
        addDative(relations, input, ci)
        return
      case "NP":
        addModifiers(relations, input.tokens, chunk)
        addPossessive(relations, input, ci)
        addAppositive(relations, input, ci)
        addTitleAppositive(relations, input, ci)
        return
      case "PP":
        addAttachment(relations, input, ci)
        return
    }
  })

  addLocations(relations, input)
  addVocatives(relations, input)
  addPossessiveRelatives(relations, input)
  addComparatives(relations, input)
  addSuperlativeDomains(relations, input)
  addSubordinateClauses(relations, input)
  addSharedObjects(relations, input)
  addQuoteContent(relations, input)
  addTemporalOpeners(relations, input)
  addObjectPredicatives(relations, input)
  addRolePredicates(relations, input)
  addPurposeInfinitives(relations, input)
  addDurationOpeners(relations, input)
  addWhAdjuncts(relations, input)
  addAdverbAttachment(relations, input)
  expandCoordination(relations, input)

  return applyPolarity(relations, input)
}

type Pins = ReadonlyMap<number, number>

// Each resolved mention resolves to the NP chunk containing all its tokens, and
// that NP becomes the subject of its nearest VP. The result maps a VP chunk
// index to its pinned subject NP chunk index.
function resolvePins(chunks: readonly Chunk[], pins: readonly SubjectPin[]): Pins {
  const out = new Map<number, number>()

  for (const pin of pins) {
    const np = npContaining(chunks, pin.tokens)

    switch (np.kind) {
      case "none":
        continue
      case "some":
        break
    }

    const vp = nearestVp(chunks, np.value)

    switch (vp.kind) {
      case "none":
        continue
      case "some":
        out.set(vp.value, np.value)
        continue
    }
  }

  return out
}

function addSubject(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const chunks = input.chunks
  const pinned = pins.get(ci)

  switch (pinned === undefined) {
    case false:
      relations.push(relation("subject-of", chunks[pinned!]!.head, chunks[ci]!.head, "pinned"))
      return
    case true:
      break
  }

  // A VP joined to the clause by a bare conjunction shares the previous verb's
  // subject: in `Minoru abriu a porta e saiu`, the NP nearest to `saiu` is the
  // OBJECT `porta` — the conjunction says the true subject is `abriu`'s.
  switch (conjJoinsPreviousClause(input, ci)) {
    case true: {
      const inherited = inheritedSubject(relations, chunks, ci)

      switch (inherited.kind) {
        case "some":
          relations.push(relation("subject-of", inherited.value.dependent, chunks[ci]!.head, inherited.value.provenance))
          return
        case "none":
          break
      }
      break
    }
    case false:
      break
  }

  const np = nearestSubjectCandidateBefore(input, ci)

  switch (np.kind) {
    case "none":
      return
    case "some":
      break
  }

  // A terminal mark between candidate and verb means the NP lives in a
  // finished sentence-within-the-paragraph-line (`— Você viu o mar? —
  // perguntou ela` keeps `mar` away from `perguntou`); the attribution verb
  // honestly has no chunked subject.
  switch (terminalBetween(input.tokens, chunks[np.value]!.to, chunks[ci]!.from)) {
    case true:
      return
    case false:
      break
  }

  const dependent = resolveRelative(input, np.value, ci)

  // A NOMINAL cannot govern a verb marked exclusively 1st/2nd person:
  // `Daniela, acho que...` addresses Daniela, it does not make her think in
  // the first person. Personal pronouns pass — they carry the person.
  switch (nominalBlocksPerson(input, dependent, chunks[ci]!.head)) {
    case true:
      return
    case false:
      break
  }

  relations.push(relation("subject-of", dependent, chunks[ci]!.head, "heuristic"))
}

// The nearest preceding NP that can honestly BE a subject: a bare clitic
// pronoun NP (`Eu ME lembro` — the `me` chunk) is a verb argument, never the
// clause's subject, so the scan steps past it.
function nearestSubjectCandidateBefore(input: RelationInput, ci: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let k = 0; k < ci; k++) {
    const chunk = input.chunks[k]!

    switch (chunk.kind === "NP" && isCliticNp(input, k) === false) {
      case true:
        best = { kind: "some", value: k }
        continue
      case false:
        continue
    }
  }

  return best
}

function isCliticNp(input: RelationInput, ci: number): boolean {
  const np = input.chunks[ci]!

  switch (np.to - np.from === 1) {
    case false:
      return false
    case true:
      break
  }

  const token = input.tokens[np.head]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      break
  }

  const lower = token.tagged.token.text.toLowerCase()

  return (
    input.syntax.accusativeClitics.includes(lower) ||
    input.syntax.dativeClitics.includes(lower) ||
    input.syntax.reflexiveClitics.includes(lower)
  )
}

// True when the verb's morphology names ONLY 1st/2nd person while the
// candidate subject is a plain nominal (NOUN/PROPN head).
function nominalBlocksPerson(input: RelationInput, dependent: number, verbHead: number): boolean {
  switch (unambiguousFirstSecond(contentFeat(input.tokens[verbHead]!), input.syntax.verbFeats)) {
    case false:
      return false
    case true:
      break
  }

  const subject = input.tokens[dependent]!

  switch (subject.role) {
    case "punctuation":
      return false
    case "content":
      return subject.tagged.pos === "NOUN" || subject.tagged.pos === "PROPN"
  }
}

// A 1st/2nd-only person digit is EVIDENCE only in tenses that actually
// distinguish 1s from 3s (`acho` P1s, `cheguei` J1s); the shared-form tenses
// (`esperava` I1s in this DELAF) carry a person label that is an artifact.
function unambiguousFirstSecond(feat: string, marks: VerbFeatMarks): boolean {
  const firstSecondOnly = /[12]/.test(feat) && feat.includes("3") === false

  switch (firstSecondOnly) {
    case false:
      return false
    case true:
      return marks.personDistinctPrefixes.some((prefix) => feat.startsWith(prefix))
  }
}

function terminalBetween(tokens: readonly AnalyzedToken[], from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = tokens[at]!

    switch (token.role) {
      case "content":
        continue
      case "punctuation":
        break
    }

    switch (token.token.text) {
      case ".":
        return true
      case "!":
        return true
      case "?":
        return true
      case "…":
        return true
      default:
        continue
    }
  }

  return false
}

// The gap between this VP and the chunk before it is one conjunction token,
// optionally trailed by adverbs — `e saiu`, but also `e sempre escrevia`,
// `e já não pensava`: the adverbs ride the conjoined verb and must not break
// the subject inheritance.
function conjJoinsPreviousClause(input: RelationInput, ci: number): boolean {
  switch (ci === 0) {
    case true:
      return false
    case false:
      break
  }

  const previous = input.chunks[ci - 1]!
  const from = previous.to
  const to = input.chunks[ci]!.from

  switch (to - from >= 1) {
    case false:
      return false
    case true:
      break
  }

  switch (contentPos(input.tokens[from]!) === "CONJ") {
    case false:
      return false
    case true:
      break
  }

  for (let at = from + 1; at < to; at++) {
    switch (contentPos(input.tokens[at]!) === "ADV") {
      case true:
        continue
      case false:
        return false
    }
  }

  return true
}

function contentPos(token: AnalyzedToken): string {
  switch (token.role) {
    case "punctuation":
      return ""
    case "content":
      return token.tagged.pos
  }
}

function inheritedSubject(
  relations: readonly Relation[],
  chunks: readonly Chunk[],
  ci: number,
): Optional<Relation> {
  const previous = previousVp(chunks, ci)

  switch (previous.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      break
  }

  const head = chunks[previous.value]!.head
  const subject = relations.find((r) => r.kind === "subject-of" && r.head === head)

  switch (subject === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: subject! }
  }
}

// A subject NP that IS a bare relative pronoun stands for its antecedent: in
// `o homem que chegou` the engine's graph wants `homem` doing the arriving,
// not `que`. The pronoun defers to the nearest NP before it; with no
// antecedent (`Quem chegou?`) it keeps the slot — an interrogative subject is
// honest as-is.
function resolveRelative(input: RelationInput, npIndex: number, vpIndex: number): number {
  const np = input.chunks[npIndex]!

  // An NP behind a possessive relative belongs to the RELATIVE CLAUSE — once
  // its own verb is spoken for (a VP stands between them), the MATRIX verb's
  // subject is the possessor: `o homem cujo gato sumiu CHORAVA` weeps the
  // man, not the cat; `sumiu` itself keeps the cat. The relative sits before
  // the chunk in Portuguese (`cujo` chunks alone) and inside it in English
  // (`whose cat` chunks together).
  const opener =
    isPossessiveRelative(input, np.from) ? np.from : np.from - 1
  const clauseVerbBetween = input.chunks.some(
    (c, k) => c.kind === "VP" && k !== vpIndex && c.from >= np.to && c.to <= input.chunks[vpIndex]!.from,
  )

  switch (opener >= 0 && isPossessiveRelative(input, opener) && clauseVerbBetween) {
    case true: {
      const owner = antecedentBefore(input, opener)

      switch (owner.kind) {
        case "some":
          return owner.value
        case "none":
          break
      }
      break
    }
    case false:
      break
  }

  switch (np.to - np.from === 1 && isRelativePronoun(input.tokens[np.head]!, input.syntax.relativePronouns)) {
    case false:
      return np.head
    case true:
      break
  }

  const antecedent = nearestNpBefore(input.chunks, npIndex)

  switch (antecedent.kind) {
    case "none":
      return np.head
    case "some":
      return input.chunks[antecedent.value]!.head
  }
}

function isPossessiveRelative(input: RelationInput, at: number): boolean {
  const lower = tokenLower(input.tokens[at]!)

  return lower !== null && input.syntax.possessiveRelatives.includes(lower)
}

function isRelativePronoun(token: AnalyzedToken, relativePronouns: readonly string[]): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return relativePronouns.includes(token.tagged.token.text.toLowerCase())
  }
}

// Quotative inversion: dialogue attribution puts the sayer AFTER the verb —
// `— Não ligue, disse Rei`, `"You're wrong," said Holmes`, `era o que
// argumentava Rei`. For a VP whose lemma is a declared verb of saying, a
// proper-noun NP starting EXACTLY at the verb's right edge (parentheticals
// hopped) is the inverted SUBJECT, never an object: what a dicendi verb says
// is a clause, and the person beside it is who says it. Three stand-downs
// keep the plain SVO reading safe:
//   * a pinned subject outranks the inversion outright;
//   * a clause-mate subject NP directly abutting the verb (`Holmes said`,
//     `Kumiko dizia mentiras`) means no inversion happened — only a bare
//     relative pronoun there is transparent (`o que argumentava Rei`, where
//     `que` is the free relative, not the sayer);
//   * the adjacency requirement keeps embedded names out — `disse que Rei
//     partiu` opens on the complementizer, not on the name.
// The earlier heuristic subject guess for the verb — usually a noun fished
// out of the quoted clause across a comma — is replaced, not doubled.
function addQuotativeInversion(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const vp = input.chunks[ci]!

  switch (input.syntax.dicendi.includes(verbLemma(input.tokens, vp))) {
    case false:
      return
    case true:
      break
  }

  switch (pins.get(ci) === undefined) {
    case false:
      return
    case true:
      break
  }

  switch (clauseMateSubjectBefore(input, ci)) {
    case true:
      return
    case false:
      break
  }

  // The pronoun sayer the pt VP rule swallowed: `perguntou ela` chunks as one
  // VP, so the tail pronoun sits INSIDE it, after the head.
  for (let at = vp.head + 1; at < vp.to; at++) {
    const lower = tokenLower(input.tokens[at]!)

    switch (lower !== null && input.syntax.anaphoricPronouns.some((a) => a.form === lower)) {
      case true:
        claimInvertedSubject(relations, at, vp.head)
        return
      case false:
        continue
    }
  }

  const start = afterParentheticals(input.tokens, vp.to)
  const candidate = firstChunkFrom(input.chunks, start)

  switch (candidate.kind) {
    case "none":
      return
    case "some":
      break
  }

  const chunk = input.chunks[candidate.value]!

  switch (chunk.kind === "NP" && chunk.from === start) {
    case false:
      return
    case true:
      break
  }

  const head = input.tokens[chunk.head]!

  switch (head.role) {
    case "punctuation":
      return
    case "content":
      break
  }

  // The sayer is a proper noun (`disse Rei`) or a 3rd-person personal
  // pronoun (`perguntou ela`) — the anaphoric-pronoun list doubles as the
  // roster of pronouns that can stand in an attribution tail.
  const sayer =
    head.tagged.pos === "PROPN" ||
    input.syntax.anaphoricPronouns.some((a) => a.form === head.tagged.token.text.toLowerCase())

  switch (sayer) {
    case false:
      return
    case true:
      break
  }

  claimInvertedSubject(relations, chunk.head, vp.head)
}

function claimInvertedSubject(relations: Relation[], dependent: number, head: number): void {
  for (let at = relations.length - 1; at >= 0; at--) {
    const existing = relations[at]!

    switch (existing.kind === "subject-of" && existing.head === head) {
      case true:
        relations.splice(at, 1)
        continue
      case false:
        continue
    }
  }

  relations.push(relation("subject-of", dependent, head, "heuristic"))
}

// An NP ending exactly where this VP starts — the preverbal subject of a
// plain SVO clause. A bare relative pronoun there does not count: it stands
// for an antecedent, not for a sayer sitting before the verb.
function clauseMateSubjectBefore(input: RelationInput, ci: number): boolean {
  const vp = input.chunks[ci]!
  const np = input.chunks.find((c) => c.kind === "NP" && c.to === vp.from)

  switch (np === undefined) {
    case true:
      return false
    case false:
      break
  }

  const bareRelative =
    np!.to - np!.from === 1 && isRelativePronoun(input.tokens[np!.head]!, input.syntax.relativePronouns)

  return bareRelative === false
}

// What the verb takes, looked for to its right past any parentheticals: the
// declared complementizer opens a clausal complement, and only failing that is
// an NP read as the direct object — the two are exclusive, since material after
// the complementizer belongs to the embedded clause.
function addComplementOrObject(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const start = afterParentheticals(input.tokens, input.chunks[ci]!.to)

  // The complementizer is NOT gated on object valency: prepositional and
  // attitude verbs take que/that-clauses too (`acreditava que`, `thought
  // that he left`) — and the reported-speech scope depends on the edge.
  switch (isComplementizer(input.tokens[start], input.syntax.complementizers)) {
    case true:
      relations.push(relation("complement-of", start, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      break
  }

  switch (takesObject(verbLemma(input.tokens, input.chunks[ci]!), input.syntax.valency)) {
    case false:
      return
    case true:
      break
  }

  addObject(relations, input, ci, start, pins)
}

function addObject(relations: Relation[], input: RelationInput, ci: number, start: number, pins: Pins): void {
  const candidate = firstChunkFrom(input.chunks, start)

  switch (candidate.kind) {
    case "none":
      return
    case "some":
      break
  }

  const chunk = input.chunks[candidate.value]!

  // A punctuation mark on the way to the candidate means it sits in another
  // clause, not in this verb's object position.
  switch (punctuationBetween(input.tokens, start, chunk.from)) {
    case true:
      return
    case false:
      break
  }

  // The inverted subject the quotative rule already claimed (`dizia Rei`) is
  // never doubled up as the verb's object.
  const claimedSubject = relations.some(
    (r) => r.kind === "subject-of" && r.head === input.chunks[ci]!.head && r.dependent === chunk.head,
  )

  switch (claimedSubject) {
    case true:
      return
    case false:
      break
  }

  // An agent-marker adposition on the way to the candidate hands a passive
  // participle its agent (`não era compartilhada por Rei`), not an object.
  // Only a bare proper noun lands here: the common-noun shape (`pelo gato`)
  // chunks as a PP and takes the PP attachment route instead.
  switch (chunk.kind === "NP" && agentMarkerBetween(input, start, chunk.from) && isPassiveParticipleVp(input, ci)) {
    case true:
      relations.push(relation("agent-of", chunk.head, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      break
  }

  // A post-verbal NP that is this verb's pinned subject is the subject, not the
  // object, so it is never doubled up as an object.
  switch (chunk.kind === "NP" && pins.get(ci) !== candidate.value) {
    case true:
      relations.push(relation("object-of", chunk.head, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      return
  }
}

// A declared agent-marker adposition among the content tokens of [from, to).
function agentMarkerBetween(input: RelationInput, from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = input.tokens[at]!

    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        break
    }

    switch (input.syntax.agentMarkers.includes(token.tagged.token.text.toLowerCase())) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// What a copular verb equates its subject with: the first postverbal NP head
// (`a beleza era uma sentença` -> sentença), or a bare postverbal adjective
// reached across leading adverbs (`o mar estava calmo` -> calmo). An
// existential copula (expletive licensed, see below) is presenting, not
// predicating, so the rule stands down there.
function addPredicate(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const lemma = verbLemma(input.tokens, input.chunks[ci]!)
  const frame = frameOf(lemma, input.syntax.valency)

  switch (frame.kind === "some" && frame.value === "copular") {
    case false:
      return
    case true:
      break
  }

  switch (copularExistential(input, ci, pins)) {
    case true:
      return
    case false:
      break
  }

  const start = afterParentheticals(input.tokens, input.chunks[ci]!.to)

  switch (isComplementizer(input.tokens[start], input.syntax.complementizers)) {
    case true:
      return
    case false:
      break
  }

  const candidate = firstChunkFrom(input.chunks, start)

  // An adjective standing BEFORE the first chunk wins the predicate slot:
  // `era mais alta que Kirie` predicates the height, and the NP after the
  // than-marker is the comparison's standard, not what Kumiko is.
  const early = adjectiveAfter(input.tokens, start)

  const adjectiveFirst =
    early.kind === "some" &&
    (candidate.kind === "none" || early.value < input.chunks[(candidate as { value: number }).value]!.from)

  switch (adjectiveFirst) {
    case true:
      relations.push(relation("predicate-of", (early as { value: number }).value, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      break
  }

  switch (candidate.kind) {
    case "some": {
      const chunk = input.chunks[candidate.value]!

      const nominal = chunk.kind === "NP" && punctuationBetween(input.tokens, start, chunk.from) === false

      switch (nominal) {
        case true:
          addPredicateNominal(relations, input, ci, candidate.value)
          return
        case false:
          break
      }
      break
    }
    case "none":
      break
  }

  const adjective = adjectiveAfter(input.tokens, start)

  switch (adjective.kind) {
    case "some":
      relations.push(relation("predicate-of", adjective.value, input.chunks[ci]!.head, "heuristic"))
      return
    case "none":
      break
  }

  // The locative/prepositional predicate: `Rei estava no bar` predicates
  // where Rei was — the copula's directly-following PP is its predicate, not
  // a plain modifier.
  switch (candidate.kind) {
    case "none":
      return
    case "some":
      break
  }

  const pp = input.chunks[candidate.value]!

  switch (pp.kind === "PP" && pp.from === start) {
    case true:
      relations.push(relation("predicate-of", pp.head, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      return
  }
}

// The postverbal NP is normally the predicate — but a verb-first copula with
// TWO adjacent postverbal NPs is the interrogative inversion (`Was it a
// dream?`, `Era ele um monstro?`): the first NP is the subject, the second
// the predicate.
function addPredicateNominal(relations: Relation[], input: RelationInput, ci: number, npIndex: number): void {
  const head = input.chunks[ci]!.head

  const inverted =
    nearestNpBefore(input.chunks, ci).kind === "none" && adjacentNp(input, npIndex).kind === "some"

  switch (inverted) {
    case false:
      relations.push(relation("predicate-of", input.chunks[npIndex]!.head, head, "heuristic"))
      return
    case true:
      break
  }

  const second = adjacentNp(input, npIndex)

  switch (second.kind) {
    case "none":
      return
    case "some":
      relations.push(relation("subject-of", input.chunks[npIndex]!.head, head, "heuristic"))
      relations.push(relation("predicate-of", input.chunks[second.value]!.head, head, "heuristic"))
      return
  }
}

// The NP chunk starting exactly where this one ends — no gap, no punctuation.
function adjacentNp(input: RelationInput, ci: number): Optional<number> {
  const next = input.chunks[ci + 1]

  switch (next === undefined) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  switch (next!.kind === "NP" && next!.from === input.chunks[ci]!.to) {
    case true:
      return { kind: "some", value: ci + 1 }
    case false:
      return { kind: "none" }
  }
}

// The first ADJ token from `start`, hopping only adverbs (`estava tão calmo`);
// anything else — punctuation, a noun, a verb — ends the scan empty-handed.
function adjectiveAfter(tokens: readonly AnalyzedToken[], start: number): Optional<number> {
  for (let at = start; at < tokens.length; at++) {
    const token = tokens[at]!

    switch (token.role) {
      case "punctuation":
        return { kind: "none" }
      case "content":
        break
    }

    switch (token.tagged.pos) {
      case "ADJ":
        return { kind: "some", value: at }
      case "ADV":
        continue
      default:
        return { kind: "none" }
    }
  }

  return { kind: "none" }
}

// An OBJECT relative clause: in `o caderno que o sacerdote confiscara` the
// relative pronoun is the verb's OBJECT and stands for its antecedent
// (confiscara -> caderno). The mirror of addSubject's relative re-pointing,
// which only covers subject relatives (`o monge que gaguejava`). Fires when:
//   * the verb admits an object yet claimed none (no object-of/complement-of);
//   * its clause opens on a declared relative pronoun, reached leftward over
//     content tokens only;
//   * a nominal sits directly before the pronoun — the antecedent (one comma
//     may intervene for the appositive shape `Maria, que o monge amava`); a
//     VERB there means a complement clause (`disse que o monge partiu`), not
//     a relative, and the rule stands down;
//   * at least one NP stands BETWEEN pronoun and verb — that NP is the
//     clause's own subject. With nothing between, the relative is a SUBJECT
//     relative (`o homem que comeu`) and the object is genuinely absent.
function addRelativeObject(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!

  switch (takesObject(verbLemma(input.tokens, vp), input.syntax.valency)) {
    case false:
      return
    case true:
      break
  }

  const claimed = relations.some(
    (r) => (r.kind === "object-of" || r.kind === "complement-of") && r.head === vp.head,
  )

  switch (claimed) {
    case true:
      return
    case false:
      break
  }

  const rel = relativeOpenerBefore(input, vp.from)

  switch (rel.kind) {
    case "none":
      return
    case "some":
      break
  }

  const subjectBetween = input.chunks.some(
    (c) => c.kind === "NP" && c.from > rel.value && c.to <= vp.from,
  )

  switch (subjectBetween) {
    case false:
      return
    case true:
      break
  }

  const antecedent = antecedentBefore(input, rel.value)

  switch (antecedent.kind) {
    case "none":
      break
    case "some": {
      // A matrix verb that already took a DIFFERENT object disowns this `que`:
      // in `ver nos olhos de Rei que ele ligava`, ver's object is olhos, so
      // the que-clause is ver's complement and Rei is no antecedent. When the
      // matrix's object IS the antecedent (`guardou o caderno que...`) the
      // relative reading stands.
      const disowned = relations.some(
        (r) =>
          r.kind === "object-of" &&
          r.head < rel.value &&
          r.dependent !== antecedent.value,
      )

      switch (disowned) {
        case true:
          return
        case false:
          relations.push(relation("object-of", antecedent.value, vp.head, "heuristic"))
          return
      }
    }
  }

  // No nominal antecedent — but a determiner right before the pronoun is the
  // FREE relative (`o que eu tinha feito`): the pronoun itself is the verb's
  // object, and the claim keeps the discourse pass from inventing an elision.
  const before = rel.value - 1

  switch (before >= 0 && contentPos(input.tokens[before]!) === "DET") {
    case true:
      relations.push(relation("object-of", rel.value, vp.head, "heuristic"))
      return
    case false:
      break
  }

  // The fronted interrogative: `Quem ele viu?` moves the verb's object to the
  // sentence front. A bare relative pronoun opening an interrogative sentence,
  // with the clause's own subject between it and the verb, is that object.
  const fronted = rel.value === firstContentIndex(input.tokens) && isInterrogative(input.tokens)

  switch (fronted) {
    case true:
      relations.push(relation("object-of", rel.value, vp.head, "heuristic"))
      return
    case false:
      return
  }
}

function isInterrogative(tokens: readonly AnalyzedToken[]): boolean {
  for (const token of tokens) {
    switch (token.role) {
      case "content":
        continue
      case "punctuation":
        break
    }

    switch (token.token.text === "?") {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// The pied-piped relative: `a casa EM QUE morei` reaches its antecedent
// through the preposition — the antecedent is the verb's OBLIQUE argument,
// whatever the verb's frame (a prepositional verb is exactly what pied-pipes
// most). Fires on ADP + relative pronoun directly before the clause's verb.
function addPiedPipedRelative(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!

  const rel = relativeOpenerBefore(input, vp.from)

  switch (rel.kind) {
    case "none":
      return
    case "some":
      break
  }

  // The pronoun binds the FIRST verb of its clause: another verb between
  // pronoun and this VP means this VP is the matrix (`a casa em que morei
  // FICAVA longe` — ficava is not the pied-piped clause's verb).
  for (let at = rel.value + 1; at < vp.from; at++) {
    switch (isVerbToken(input.tokens[at]!)) {
      case true:
        return
      case false:
        continue
    }
  }

  const before = rel.value - 1

  switch (before >= 0 && contentPos(input.tokens[before]!) === "ADP") {
    case false:
      return
    case true:
      break
  }

  const antecedent = antecedentBefore(input, before)

  switch (antecedent.kind) {
    case "none":
      return
    case "some":
      break
  }

  const already = relations.some(
    (r) => (r.kind === "oblique-of" || r.kind === "object-of") && r.head === vp.head,
  )

  switch (already) {
    case true:
      return
    case false:
      relations.push(relation("oblique-of", antecedent.value, vp.head, "heuristic"))
      return
  }
}

// The nearest relative-pronoun token left of `from`, reached across content
// tokens only — any punctuation on the way means the pronoun belongs to
// another clause.
function relativeOpenerBefore(input: RelationInput, from: number): Optional<number> {
  for (let at = from - 1; at >= 0; at--) {
    const token = input.tokens[at]!

    switch (token.role) {
      case "punctuation":
        return { kind: "none" }
      case "content":
        break
    }

    switch (input.syntax.relativePronouns.includes(token.tagged.token.text.toLowerCase())) {
      case true:
        return { kind: "some", value: at }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

// The nominal directly before the relative pronoun — hopping a single comma
// for the appositive shape — resolved to its chunk's head token.
function antecedentBefore(input: RelationInput, rel: number): Optional<number> {
  let at = rel - 1

  switch (at >= 0 && isComma(input.tokens[at])) {
    case true:
      at--
      break
    case false:
      break
  }

  switch (at < 0) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const token = input.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return { kind: "none" }
    case "content":
      break
  }

  switch (token.tagged.pos === "NOUN" || token.tagged.pos === "PROPN") {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const holder = input.chunks.find((c) => at >= c.from && at < c.to)

  switch (holder === undefined) {
    case true:
      return { kind: "some", value: at }
    case false:
      return { kind: "some", value: holder!.head }
  }
}

// A presentational (unaccusative/existential) verb takes a POSTVERBAL subject:
// `Aqui só existe o vento` predicates existence OF the wind, so the first NP
// after the verb is its subject, not its object — but only when no NP precedes
// the verb (a preverbal NP already claimed the subject slot: `o verão existe
// mesmo aí`) and no pin already named one. A copular verb earns the same
// inversion behind a declared expletive (`There was a well`): English demands
// an overt subject, so a dummy `there` is the licence pro-drop Portuguese
// never needs. Same hop-and-boundary discipline as the object rule:
// parentheticals are crossed, other punctuation is a clause boundary.
function addPresentationalSubject(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const lemma = verbLemma(input.tokens, input.chunks[ci]!)
  const frame = frameOf(lemma, input.syntax.valency)

  switch (frame.kind) {
    case "none":
      return
    case "some":
      break
  }

  switch (frame.value) {
    case "presentational": {
      switch (pins.get(ci) === undefined && nearestNpBefore(input.chunks, ci).kind === "none") {
        case false:
          return
        case true:
          break
      }
      break
    }
    case "copular": {
      switch (copularExistential(input, ci, pins)) {
        case false:
          return
        case true:
          break
      }
      break
    }
    case "intransitive":
      return
    case "transitive":
      return
    case "ditransitive":
      return
    case "prepositional":
      return
  }

  const start = afterParentheticals(input.tokens, input.chunks[ci]!.to)
  const candidate = firstChunkFrom(input.chunks, start)

  switch (candidate.kind) {
    case "none":
      return
    case "some":
      break
  }

  const chunk = input.chunks[candidate.value]!

  switch (chunk.kind === "NP" && punctuationBetween(input.tokens, start, chunk.from) === false) {
    case true:
      relations.push(relation("subject-of", chunk.head, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
      return
  }
}

// An expletive dummy sits directly before the copula (across at most other
// adverbs: `There never was...`), and nothing pinned a subject. The scan
// starts inside the VP chunk — the English VP rule absorbs leading adverbs,
// so `There was` carries its own expletive.
function copularExistential(input: RelationInput, ci: number, pins: Pins): boolean {
  switch (pins.get(ci) === undefined && input.syntax.expletives.length > 0) {
    case false:
      return false
    case true:
      break
  }

  for (let at = input.chunks[ci]!.head - 1; at >= 0; at--) {
    const token = input.tokens[at]!

    switch (token.role) {
      case "punctuation":
        return false
      case "content":
        break
    }

    switch (token.tagged.pos === "ADV") {
      case false:
        return false
      case true:
        break
    }

    switch (input.syntax.expletives.includes(token.tagged.token.text.toLowerCase())) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// A VP headed by a morphologically-marked infinitive is the complement of the
// nearest preceding VP when only content tokens separate them: `veio ver`
// chains directly, and the perception small clause `ver o pavilhão arder`
// chains across the object NP. A comma or stronger mark between the verbs is a
// clause boundary and breaks the chain. Not gated by valency: a motion verb
// rejects an object yet takes exactly this complement.
function addInfinitiveChain(relations: Relation[], input: RelationInput, ci: number): void {
  const chunk = input.chunks[ci]!

  switch (isInfinitive(input.tokens[chunk.head]!, input.syntax.verbFeats)) {
    case false:
      return
    case true:
      break
  }

  const previous = previousVp(input.chunks, ci)

  switch (previous.kind) {
    case "none":
      return
    case "some":
      break
  }

  const matrix = input.chunks[previous.value]!

  switch (punctuationBetween(input.tokens, matrix.to, chunk.from)) {
    case true:
      return
    case false:
      relations.push(relation("complement-of", chunk.head, matrix.head, "heuristic"))
      return
  }
}

// The participle mirror of the infinitive chain: a VP headed by a
// morphologically-marked participle continues the nearest preceding VP —
// the passive (`foi comido`) and perfect (`tinha visto o mar`) periphrases
// both land here, and a perception small clause (`viu o mar coberto`) chains
// across the object NP exactly as the infinitive one does.
function addParticipleChain(relations: Relation[], input: RelationInput, ci: number): void {
  const chunk = input.chunks[ci]!

  switch (isParticiple(input.tokens[chunk.head]!, input.syntax.verbFeats)) {
    case false:
      return
    case true:
      break
  }

  const previous = previousVp(input.chunks, ci)

  switch (previous.kind) {
    case "none":
      return
    case "some":
      break
  }

  const matrix = input.chunks[previous.value]!

  switch (punctuationBetween(input.tokens, matrix.to, chunk.from)) {
    case true:
      return
    case false:
      relations.push(relation("complement-of", chunk.head, matrix.head, "heuristic"))
      return
  }
}

// Hop over comma-bounded parenthetical stretches: from a position sitting on a
// comma, jump past the matching closing comma and repeat. A comma with no later
// closing comma is a clause boundary, not a parenthetical, so the position
// stays on it.
function afterParentheticals(tokens: readonly AnalyzedToken[], from: number): number {
  let at = from

  while (isComma(tokens[at])) {
    const close = nextComma(tokens, at + 1)

    switch (close.kind) {
      case "none":
        return at
      case "some":
        at = close.value + 1
        continue
    }
  }

  return at
}

function isComma(token: AnalyzedToken | undefined): boolean {
  switch (token === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (token!.role) {
    case "punctuation":
      return token!.token.text === ","
    case "content":
      return false
  }
}

function nextComma(tokens: readonly AnalyzedToken[], from: number): Optional<number> {
  for (let at = from; at < tokens.length; at++) {
    switch (isComma(tokens[at])) {
      case true:
        return { kind: "some", value: at }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

function isComplementizer(token: AnalyzedToken | undefined, complementizers: readonly string[]): boolean {
  switch (token === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (token!.role) {
    case "punctuation":
      return false
    case "content":
      return complementizers.includes(token!.tagged.token.text.toLowerCase())
  }
}

function isInfinitive(token: AnalyzedToken, marks: VerbFeatMarks): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return (
        token.tagged.pos === "VERB" &&
        marks.infinitivePrefixes.some((prefix) => token.tagged.feat.startsWith(prefix))
      )
  }
}

function isParticiple(token: AnalyzedToken, marks: VerbFeatMarks): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return (
        token.tagged.pos === "VERB" &&
        marks.participlePrefixes.some((prefix) => token.tagged.feat.startsWith(prefix))
      )
  }
}

function firstChunkFrom(chunks: readonly Chunk[], start: number): Optional<number> {
  for (const [ci, chunk] of chunks.entries()) {
    switch (chunk.from >= start) {
      case true:
        return { kind: "some", value: ci }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

// Quote marks are TRANSPARENT here: `li "Um estudo em Vermelho"` hands the
// verb its quoted object — the quotes typeset the title, they don't close the
// clause. Every other mark still bounds it.
function punctuationBetween(tokens: readonly AnalyzedToken[], from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = tokens[at]!

    switch (token.role) {
      case "punctuation":
        break
      case "content":
        continue
    }

    switch (isQuoteMark(token.token.text)) {
      case true:
        continue
      case false:
        return true
    }
  }

  return false
}

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

function previousVp(chunks: readonly Chunk[], ci: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let k = 0; k < ci; k++) {
    switch (chunks[k]!.kind === "VP") {
      case true:
        best = { kind: "some", value: k }
        continue
      case false:
        continue
    }
  }

  return best
}

function addModifiers(relations: Relation[], tokens: readonly AnalyzedToken[], np: Chunk): void {
  for (let i = np.from; i < np.to; i++) {
    const modifies = isAdjective(tokens[i]!) && i !== np.head

    switch (modifies) {
      case true:
        relations.push(relation("modifier-of", i, np.head, "heuristic"))
        continue
      case false:
        continue
    }
  }
}

// A PP attaches to the head it trails: the nearest preceding NP or VP chunk.
// Two PPs outrank that default. A GENITIVE PP directly abutting a preceding
// PP nests under that PP's head (`ao fundo do poço` — poço qualifies fundo,
// not the verb), which is what lets qualification chains answer "quais? de
// onde?". And the agent of a passive (`comido pelo gato`, `seen by the
// sailor`): its adposition is a declared agent marker and its anchor is a
// passive participle, so the edge is `agent-of`, the relation the "who did
// it" graph question reads.
function addAttachment(relations: Relation[], input: RelationInput, ci: number): void {
  // A PP some verb already GOVERNS (oblique-of, dative-of, predicate-of) is
  // an argument, not an adjunct — no second, weaker edge.
  const claimed = relations.some(
    (r) =>
      (r.kind === "oblique-of" || r.kind === "dative-of" || r.kind === "predicate-of") &&
      r.dependent === input.chunks[ci]!.head,
  )

  switch (claimed) {
    case true:
      return
    case false:
      break
  }

  const genitiveHost = nestedGenitiveHost(input, ci)

  switch (genitiveHost.kind) {
    case "some":
      relations.push(relation("modifier-of", input.chunks[ci]!.head, genitiveHost.value, "heuristic"))
      return
    case "none":
      break
  }

  const anchor = nearestAnchorBefore(input.chunks, ci)

  switch (anchor.kind) {
    case "none":
      // A sentence-opening TIME PP frames the clause ahead of it: `Naquela
      // noite, li o caderno` — temporal-of onto the first verb. Non-temporal
      // openers keep the honest silence.
      addForwardTemporal(relations, input, ci)
      return
    case "some":
      break
  }

  const agentive = isAgentPp(input, ci) && isPassiveParticipleVp(input, anchor.value)

  switch (agentive) {
    case true:
      relations.push(relation("agent-of", input.chunks[ci]!.head, input.chunks[anchor.value]!.head, "heuristic"))
      return
    case false:
      break
  }

  // A time-naming PP frames the EVENT, not the nearest nominal: `li o caderno
  // naquela noite` — the night belongs to the reading, so a temporal head
  // reaches past a nearer NP to the last verb.
  switch (isTemporalHead(input, ci)) {
    case false:
      break
    case true: {
      const vp = lastVpBefore(input.chunks, ci)

      switch (vp.kind) {
        case "some":
          relations.push(relation("temporal-of", input.chunks[ci]!.head, input.chunks[vp.value]!.head, "heuristic"))
          return
        case "none":
          break
      }
      break
    }
  }

  relations.push(relation("modifier-of", input.chunks[ci]!.head, input.chunks[anchor.value]!.head, "heuristic"))
}

function isTemporalHead(input: RelationInput, ci: number): boolean {
  const head = input.tokens[input.chunks[ci]!.head]!

  switch (head.role) {
    case "punctuation":
      return false
    case "content":
      return input.syntax.temporalNouns.includes(head.tagged.lemma.toLowerCase())
  }
}

function addForwardTemporal(relations: Relation[], input: RelationInput, ci: number): void {
  switch (isTemporalHead(input, ci)) {
    case false:
      return
    case true:
      break
  }

  const vp = input.chunks.find((c) => c.kind === "VP" && c.from >= input.chunks[ci]!.to)

  switch (vp === undefined) {
    case true:
      return
    case false:
      relations.push(relation("temporal-of", input.chunks[ci]!.head, vp!.head, "heuristic"))
      return
  }
}

// The head this genitive PP nests under: the immediately preceding chunk when
// it is a PP with zero tokens between them and this PP opens on a declared
// genitive marker. Any gap (a comma, an intervening word) breaks the nest and
// the default anchoring applies.
function nestedGenitiveHost(input: RelationInput, ci: number): Optional<number> {
  switch (ci === 0) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const previous = input.chunks[ci - 1]!
  const chunk = input.chunks[ci]!

  switch (previous.kind === "PP" && previous.to === chunk.from) {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const opener = input.tokens[chunk.from]!

  switch (opener.role) {
    case "punctuation":
      return { kind: "none" }
    case "content":
      break
  }

  switch (input.syntax.genitiveMarkers.includes(opener.tagged.token.text.toLowerCase())) {
    case true:
      return { kind: "some", value: previous.head }
    case false:
      return { kind: "none" }
  }
}

// Place relatives: `o quintal do vizinho, onde um poço esperava` locates the
// embedded clause's subject IN the antecedent — located-in(poço -> quintal).
// The antecedent is the nominal before the place adverb (one comma may
// intervene), climbed out of any genitive chain to the outermost nominal head
// (`do vizinho` resolves up to quintal); the located thing is the subject the
// per-chunk passes already found for the first VP after the adverb. Runs as a
// post-pass because it reads those subject relations.
function addLocations(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    switch (token.role) {
      case "punctuation":
        return
      case "content":
        break
    }

    switch (input.syntax.relativePlaceAdverbs.includes(token.tagged.token.text.toLowerCase())) {
      case false:
        return
      case true:
        break
    }

    const antecedent = antecedentBefore(input, ti)

    switch (antecedent.kind) {
      case "none":
        return
      case "some":
        break
    }

    const place = climbGenitives(relations, input, antecedent.value)

    const vp = input.chunks.find((c) => c.kind === "VP" && c.from > ti)

    switch (vp === undefined || terminalBetween(input.tokens, ti, vp!.from)) {
      case true:
        return
      case false:
        break
    }

    const subject = relations.find((r) => r.kind === "subject-of" && r.head === vp!.head)

    switch (subject === undefined) {
      case true:
        return
      case false:
        relations.push(relation("located-in", subject!.dependent, place, "heuristic"))
        return
    }
  })
}

// Out of a genitive chain, to the outermost nominal: `vizinho` -(modifier-of)->
// `quintal` stops there because quintal modifies nothing nominal above it.
function climbGenitives(relations: readonly Relation[], input: RelationInput, at: number): number {
  let current = at

  for (let hops = 0; hops < 3; hops++) {
    const up = relations.find((r) => r.kind === "modifier-of" && r.dependent === current)

    switch (up === undefined) {
      case true:
        return current
      case false:
        break
    }

    const head = input.tokens[up!.head]!

    switch (head.role === "content" && (head.tagged.pos === "NOUN" || head.tagged.pos === "PROPN")) {
      case false:
        return current
      case true:
        current = up!.head
    }
  }

  return current
}

function isAgentPp(input: RelationInput, ci: number): boolean {
  const opener = input.tokens[input.chunks[ci]!.from]!

  switch (opener.role) {
    case "punctuation":
      return false
    case "content":
      return input.syntax.agentMarkers.includes(opener.tagged.token.text.toLowerCase())
  }
}

// A VP headed by a participle whose nearest preceding VP is a passive
// auxiliary (ser/estar/be), with no clause boundary between the two.
function isPassiveParticipleVp(input: RelationInput, ci: number): boolean {
  const chunk = input.chunks[ci]!

  switch (chunk.kind === "VP" && isParticiple(input.tokens[chunk.head]!, input.syntax.verbFeats)) {
    case false:
      return false
    case true:
      break
  }

  const previous = previousVp(input.chunks, ci)

  switch (previous.kind) {
    case "none":
      return false
    case "some":
      break
  }

  const matrix = input.chunks[previous.value]!

  switch (punctuationBetween(input.tokens, matrix.to, chunk.from)) {
    case true:
      return false
    case false:
      return input.syntax.passiveAuxiliaries.includes(verbLemma(input.tokens, matrix))
  }
}

// The English possessive built by the tagger's retag pass: `NP 's NP` reads
// the first NP as modifier of the second (`the cat's tail` — cat -> tail).
function addPossessive(relations: Relation[], input: RelationInput, ci: number): void {
  const np = input.chunks[ci]!
  const markerAt = np.from - 1

  switch (markerAt > 0 && isPossessiveMarker(input.tokens[markerAt])) {
    case false:
      return
    case true:
      break
  }

  const owner = input.chunks.find((c) => c.kind === "NP" && c.to === markerAt)

  switch (owner === undefined) {
    case true:
      return
    case false:
      relations.push(relation("modifier-of", owner!.head, np.head, "heuristic"))
      return
  }
}

function isPossessiveMarker(token: AnalyzedToken | undefined): boolean {
  switch (token === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (token!.role) {
    case "punctuation":
      return false
    case "content":
      return token!.tagged.pos === "PART" && token!.tagged.lemma === "'s"
  }
}

// ─── se-constructions ────────────────────────────────────────────────────────
// The reflexive clitic riding a verb is three grammars in one surface:
//   * the SE-PASSIVE — `Vendem-se casas`: no preverbal subject candidate and a
//     postverbal NP; that NP is the grammatical subject (the patient), exactly
//     the presentational inversion shape;
//   * the reflexive/reciprocal — `Ela se abraçou`, `abraçaram-se`: the verb's
//     argument is its own subject; the clitic itself carries the relation;
//   * the impersonal — `vivia-se bem`: no NP at all; the clitic still claims
//     the verb so the elision pass knows nothing was dropped.
// The conditional homograph (`Se chovesse...`) never reaches here: a proclitic
// `se` must ride directly against its verb AFTER other clause material — a
// sentence-initial or post-punctuation `se` is the subordinator's.
function addSePassive(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const vp = input.chunks[ci]!
  const se = reflexiveCliticOf(input, ci)

  switch (se.kind) {
    case "none":
      return
    case "some":
      break
  }

  relations.push(relation("reflexive-of", se.value, vp.head, "heuristic"))

  const preverbal = nearestSubjectCandidateBefore(input, ci)
  const start = afterParentheticals(input.tokens, vp.to)
  const candidate = firstChunkFrom(input.chunks, start)

  const inverts =
    pins.get(ci) === undefined && preverbal.kind === "none" && candidate.kind === "some"

  switch (inverts) {
    case false:
      return
    case true:
      break
  }

  const chunk = input.chunks[(candidate as { value: number }).value]!

  switch (chunk.kind === "NP" && punctuationBetween(input.tokens, start, chunk.from) === false) {
    case true:
      relations.push(relation("subject-of", chunk.head, vp.head, "heuristic"))
      return
    case false:
      return
  }
}

// The verb-adjacent reflexive clitic: enclitic inside the VP chunk (the
// hyphen split of `abraçaram-se`), or a bare proclitic NP directly abutting
// it that FOLLOWS other clause content.
function reflexiveCliticOf(input: RelationInput, ci: number): Optional<number> {
  const vp = input.chunks[ci]!

  for (let at = vp.head + 1; at < vp.to; at++) {
    switch (tokenLower(input.tokens[at]!) !== null && input.syntax.reflexiveClitics.includes(tokenLower(input.tokens[at]!)!)) {
      case true:
        return { kind: "some", value: at }
      case false:
        continue
    }
  }

  return procliticOf(input, ci, input.syntax.reflexiveClitics)
}

function procliticOf(input: RelationInput, ci: number, clitics: readonly string[]): Optional<number> {
  const vp = input.chunks[ci]!
  const np = input.chunks.find((c) => c.kind === "NP" && c.to === vp.from && c.to - c.from === 1)

  switch (np === undefined) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const lower = tokenLower(input.tokens[np!.head]!)

  switch (lower !== null && clitics.includes(lower!)) {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  // Sentence-initial or post-punctuation position belongs to the homographs
  // (conditional `Se...`); a true proclitic follows clause material.
  const before = np!.from - 1

  switch (before >= 0 && input.tokens[before]!.role === "content") {
    case true:
      return { kind: "some", value: np!.head }
    case false:
      return { kind: "none" }
  }
}

function tokenLower(token: AnalyzedToken): string | null {
  switch (token.role) {
    case "punctuation":
      return null
    case "content":
      return token.tagged.token.text.toLowerCase()
  }
}

// ─── clitic arguments ────────────────────────────────────────────────────────
// An object pronoun riding the verb IS the verb's argument: `disse-me` hands
// the recipient, `me encontrou` the patient. The valency frame arbitrates the
// case of the ambiguous clitics (me/te/nos): a ditransitive or copular reads
// them dative, an object-taking verb accusative, and a verb that takes
// neither leaves them honestly unbound (`me lembro` — the pronominal-verb
// construction this engine does not yet model).
function addCliticArguments(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!
  const lemma = verbLemma(input.tokens, vp)
  const frame = frameOf(lemma, input.syntax.valency)

  for (const at of cliticTokensOf(input, ci)) {
    const lower = tokenLower(input.tokens[at]!)!

    switch (input.syntax.reflexiveClitics.includes(lower)) {
      case true:
        continue
      case false:
        break
    }

    const dativeFirst =
      frame.kind === "some" && (frame.value === "ditransitive" || frame.value === "copular")

    switch (dativeFirst && input.syntax.dativeClitics.includes(lower)) {
      case true:
        relations.push(relation("dative-of", at, vp.head, "heuristic"))
        continue
      case false:
        break
    }

    switch (takesObject(lemma, input.syntax.valency) && input.syntax.accusativeClitics.includes(lower)) {
      case true:
        relations.push(relation("object-of", at, vp.head, "heuristic"))
        continue
      case false:
        break
    }

    const dativeOnly =
      input.syntax.dativeClitics.includes(lower) && input.syntax.accusativeClitics.includes(lower) === false

    switch (dativeOnly) {
      case true:
        relations.push(relation("dative-of", at, vp.head, "heuristic"))
        continue
      case false:
        continue
    }
  }
}

function cliticTokensOf(input: RelationInput, ci: number): readonly number[] {
  const vp = input.chunks[ci]!
  const all = [
    ...input.syntax.accusativeClitics,
    ...input.syntax.dativeClitics,
    ...input.syntax.reflexiveClitics,
  ]

  const out: number[] = []

  for (let at = vp.head + 1; at < vp.to; at++) {
    const lower = tokenLower(input.tokens[at]!)

    switch (lower !== null && all.includes(lower!)) {
      case true:
        out.push(at)
        continue
      case false:
        continue
    }
  }

  const proclitic = procliticOf(input, ci, all)

  switch (proclitic.kind) {
    case "some":
      out.push(proclitic.value)
      break
    case "none":
      break
  }

  return out
}

// The article-shaped accusative proclitic: in `Eu o vi`, the `o` is him, not
// a determiner — surface-identical to the article, distinguished by
// POSITION: an unchunked determiner-tagged article directly against a verb
// that takes objects, following other clause material (sentence-initial `O
// vento...` chunks with its noun and never lands here).
function addBareProclitic(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!

  switch (takesObject(verbLemma(input.tokens, vp), input.syntax.valency)) {
    case false:
      return
    case true:
      break
  }

  const at = vp.from - 1

  switch (at >= 1) {
    case false:
      return
    case true:
      break
  }

  const token = input.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return
    case "content":
      break
  }

  const lower = token.tagged.token.text.toLowerCase()

  const articleClitic =
    token.tagged.pos === "DET" &&
    input.syntax.definiteArticles.includes(lower) &&
    input.chunks.some((c) => at >= c.from && at < c.to) === false &&
    input.tokens[at - 1]!.role === "content"

  switch (articleClitic) {
    case false:
      return
    case true:
      relations.push(relation("object-of", at, vp.head, "heuristic"))
      return
  }
}

// The light-verb construction: when the verb's object completes a declared
// verb+noun pair (`deu um passeio`), the pair is marked as ONE event — the
// unified lemma lives in the syntax data, keyed by the same pair.
function addLightVerb(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!
  const verb = verbLemma(input.tokens, vp)

  const object = relations.find((r) => r.kind === "object-of" && r.head === vp.head)

  switch (object === undefined) {
    case true:
      return
    case false:
      break
  }

  const noun = input.tokens[object!.dependent]!

  switch (noun.role) {
    case "punctuation":
      return
    case "content":
      break
  }

  const pair = input.syntax.lightVerbs.some((l) => l.verb === verb && l.noun === noun.tagged.lemma)

  switch (pair) {
    case false:
      return
    case true:
      relations.push(relation("light-verb-of", object!.dependent, vp.head, "heuristic"))
      return
  }
}

// ─── verb chains and particles ───────────────────────────────────────────────
// The gerund mirror of the participle chain: the progressive periphrasis
// (`estava correndo`, `was running`) and the manner chain (`saiu correndo`)
// both continue the nearest preceding VP.
function addGerundChain(relations: Relation[], input: RelationInput, ci: number): void {
  const chunk = input.chunks[ci]!

  switch (isGerund(input.tokens[chunk.head]!, input.syntax.verbFeats)) {
    case false:
      return
    case true:
      break
  }

  const previous = previousVp(input.chunks, ci)

  switch (previous.kind) {
    case "none":
      return
    case "some":
      break
  }

  const matrix = input.chunks[previous.value]!

  switch (punctuationBetween(input.tokens, matrix.to, chunk.from)) {
    case true:
      return
    case false:
      relations.push(relation("complement-of", chunk.head, matrix.head, "heuristic"))
      return
  }
}

function isGerund(token: AnalyzedToken, marks: VerbFeatMarks): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return (
        token.tagged.pos === "VERB" &&
        marks.gerundPrefixes.some((prefix) => token.tagged.feat.startsWith(prefix))
      )
  }
}

// The English modal chain: a bare (featless) verb directly after a declared
// modal — across at most a single `to` — is its complement (`could leave`,
// `wanted to leave`). Portuguese modals chain through the marked infinitive
// already; this rule is what an infinitive-less morphology needs instead.
function addModalChain(relations: Relation[], input: RelationInput, ci: number): void {
  const chunk = input.chunks[ci]!
  const head = input.tokens[chunk.head]!

  const bare =
    head.role === "content" && head.tagged.pos === "VERB" && head.tagged.feat === ""

  switch (bare) {
    case false:
      return
    case true:
      break
  }

  const previous = previousVp(input.chunks, ci)

  switch (previous.kind) {
    case "none":
      return
    case "some":
      break
  }

  const matrix = input.chunks[previous.value]!

  switch (input.syntax.modalVerbs.includes(verbLemma(input.tokens, matrix))) {
    case false:
      return
    case true:
      break
  }

  const gap = chunk.from - matrix.to
  const between = gap === 1 ? tokenLower(input.tokens[matrix.to]!) : null

  const adjacent =
    gap === 0 || (gap === 1 && between !== null && input.syntax.purposeMarkers.includes(between!))

  switch (adjacent) {
    case false:
      return
    case true:
      break
  }

  const claimed = relations.some((r) => r.kind === "complement-of" && r.dependent === chunk.head)

  switch (claimed) {
    case true:
      return
    case false:
      relations.push(relation("complement-of", chunk.head, matrix.head, "heuristic"))
      return
  }
}

// A declared particle directly at the verb's right edge forms a unit with it
// (`gave up`, `looked back`) — unless it opens a PP chunk there, in which
// case it is a plain preposition (`went up the stairs`).
function addParticle(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!
  const at = vp.to
  const token = input.tokens[at]

  switch (token === undefined) {
    case true:
      return
    case false:
      break
  }

  const lower = tokenLower(token!)

  switch (lower !== null && input.syntax.particles.includes(lower!)) {
    case false:
      return
    case true:
      break
  }

  const opensPp = input.chunks.some((c) => c.kind === "PP" && c.from === at)

  switch (opensPp) {
    case true:
      return
    case false:
      relations.push(relation("particle-of", at, vp.head, "heuristic"))
      return
  }
}

// ─── oblique and dative arguments ────────────────────────────────────────────
// A prepositional-frame verb GOVERNS its PP: `gostar de`, `pensar em`,
// `depend on` bind their argument as oblique-of instead of leaving it a plain
// modifier. The bare-proper-noun shape (`gostava da Daniela` — ADP+PROPN
// chunks as no PP) is reached through the same between-token route the
// passive agent uses.
function addOblique(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!
  const frame = frameOf(verbLemma(input.tokens, vp), input.syntax.valency)

  switch (frame.kind === "some" && frame.value === "prepositional") {
    case false:
      return
    case true:
      break
  }

  const start = afterParentheticals(input.tokens, vp.to)
  const candidate = firstChunkFrom(input.chunks, start)

  switch (candidate.kind) {
    case "none":
      return
    case "some":
      break
  }

  const chunk = input.chunks[candidate.value]!

  switch (punctuationBetween(input.tokens, start, chunk.from)) {
    case true:
      return
    case false:
      break
  }

  switch (chunk.kind) {
    case "PP":
      switch (chunk.from === start) {
        case true:
          relations.push(relation("oblique-of", chunk.head, vp.head, "heuristic"))
          return
        case false:
          return
      }
    case "NP":
      switch (adpositionBetween(input, start, chunk.from)) {
        case true:
          relations.push(relation("oblique-of", chunk.head, vp.head, "heuristic"))
          return
        case false:
          return
      }
    case "VP":
      return
  }
}

function adpositionBetween(input: RelationInput, from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = input.tokens[at]!

    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        break
    }

    switch (token.tagged.pos === "ADP") {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// A ditransitive's RECIPIENT: the dative-marked PP after the object (`deu o
// livro A MARIA`, `entregou o caderno AO SACERDOTE`, `gave the book TO
// MARY`), the bare name behind a dative marker, or — English only — the
// double-object inversion (`gave MARY the book`: two adjacent postverbal NPs,
// the first a person, flip to recipient + object).
function addDative(relations: Relation[], input: RelationInput, ci: number): void {
  const vp = input.chunks[ci]!
  const frame = frameOf(verbLemma(input.tokens, vp), input.syntax.valency)

  switch (frame.kind === "some" && frame.value === "ditransitive") {
    case false:
      return
    case true:
      break
  }

  switch (reassignDoubleObject(relations, input, ci)) {
    case true:
      return
    case false:
      break
  }

  for (const [k, chunk] of input.chunks.entries()) {
    switch (chunk.from >= vp.to && k !== ci) {
      case false:
        continue
      case true:
        break
    }

    switch (punctuationBetween(input.tokens, vp.to, chunk.from)) {
      case true:
        return
      case false:
        break
    }

    switch (chunk.kind) {
      case "PP": {
        const opener = tokenLower(input.tokens[chunk.from]!)

        switch (opener !== null && input.syntax.dativeMarkers.includes(opener!)) {
          case true:
            relations.push(relation("dative-of", chunk.head, vp.head, "heuristic"))
            return
          case false:
            continue
        }
      }
      case "NP": {
        const before = chunk.from - 1

        switch (before >= vp.to) {
          case false:
            continue
          case true:
            break
        }

        const marker = tokenLower(input.tokens[before]!)

        switch (marker !== null && input.syntax.dativeMarkers.includes(marker!)) {
          case true:
            relations.push(relation("dative-of", chunk.head, vp.head, "heuristic"))
            return
          case false:
            continue
        }
      }
      case "VP":
        continue
    }
  }
}

// `gave Mary the book`: the object rule grabbed Mary; two directly-adjacent
// postverbal NPs with a person-shaped first one flip to recipient + object.
function reassignDoubleObject(relations: Relation[], input: RelationInput, ci: number): boolean {
  const vp = input.chunks[ci]!
  const objIndex = relations.findIndex((r) => r.kind === "object-of" && r.head === vp.head)

  switch (objIndex < 0) {
    case true:
      return false
    case false:
      break
  }

  const obj = relations[objIndex]!
  const objChunkIndex = input.chunks.findIndex((c) => c.kind === "NP" && c.head === obj.dependent && c.from >= vp.to)

  switch (objChunkIndex < 0) {
    case true:
      return false
    case false:
      break
  }

  const recipientToken = input.tokens[obj.dependent]!

  // A person-shaped recipient: proper noun, pronoun, or a capitalized noun —
  // English names often resolve through the plain NOUN table (`Mary`).
  const person =
    recipientToken.role === "content" &&
    (recipientToken.tagged.pos === "PROPN" ||
      recipientToken.tagged.pos === "PRON" ||
      (recipientToken.tagged.pos === "NOUN" && /^[A-ZÀ-Ý]/.test(recipientToken.tagged.token.text)))

  switch (person) {
    case false:
      return false
    case true:
      break
  }

  const second = adjacentNp(input, objChunkIndex)

  switch (second.kind) {
    case "none":
      return false
    case "some":
      break
  }

  relations.splice(objIndex, 1)
  relations.push(relation("dative-of", obj.dependent, vp.head, "heuristic"))
  relations.push(relation("object-of", input.chunks[second.value]!.head, vp.head, "heuristic"))

  return true
}

// Coordinated NPs share their relation: once `subject-of`/`object-of`/
// `predicate-of` lands on one head of an `NP (, NP)* CONJ NP` chain, every
// other head in the chain earns the same edge — `Maria e João chegaram`
// subjects both, `comprou pão e vinho` objects both. A comma-only run is NOT
// a chain (that shape is a clause boundary); at least one link must be a
// conjunction.
function expandCoordination(relations: Relation[], input: RelationInput): void {
  const groups = coordinatedNpGroups(input)

  const expanded: Relation[] = []

  for (const group of groups) {
    const heads = group.map((ci) => input.chunks[ci]!.head)

    for (const existing of relations) {
      switch (spreadsAcrossCoordination(existing.kind) && heads.includes(existing.dependent)) {
        case false:
          continue
        case true:
          break
      }

      for (const head of heads) {
        // An NP that already earned its own spreading-kind relation is a
        // clause-mate, not a list member: in `the sea was dark and the wind
        // was cold`, `dark CONJ the wind` matches the list surface, but
        // `wind` subjects its own copula — spreading would cross the clauses.
        const engaged =
          head === existing.dependent ||
          relations.some((r) => spreadsAcrossCoordination(r.kind) && r.dependent === head) ||
          expanded.some((r) => r.kind === existing.kind && r.dependent === head && r.head === existing.head)

        switch (engaged) {
          case true:
            continue
          case false:
            // Always heuristic: even off a pinned source, only the pinned NP
            // itself was authored — its coordinate sibling is inferred.
            expanded.push(relation(existing.kind, head, existing.head, "heuristic"))
        }
      }
    }
  }

  relations.push(...expanded)
}

function spreadsAcrossCoordination(kind: RelationKind): boolean {
  switch (kind) {
    case "subject-of":
      return true
    case "object-of":
      return true
    case "predicate-of":
      return true
    case "complement-of":
      return false
    case "modifier-of":
      return false
    case "agent-of":
      return true
    case "located-in":
      return false
    case "oblique-of":
      return false
    case "dative-of":
      return false
    case "particle-of":
      return false
    case "vocative-of":
      return false
    case "appositive-of":
      return false
    case "compared-to":
      return false
    case "temporal-of":
      return false
    case "reflexive-of":
      return false
    case "adverbial-of":
      return false
    case "light-verb-of":
      return false
    case "advmod-of":
      return false
    case "degree-of":
      return false
    case "predicative-of":
      return false
    case "role-of":
      return false
    case "purpose-of":
      return false
    case "duration-of":
      return false
  }
}

// ─── sentence post-passes ────────────────────────────────────────────────────
// A comma-bound NP opening on an article renames the nominal before it:
// `Daniela, UMA MULHER que conheci` and `Rei, O DETETIVE` both describe the
// name. Indefinite openers rename any nominal; DEFINITE openers demand a
// proper-noun anchor — that gate is what keeps `pão, o vinho e o queijo`
// a list, not a renaming.
function addAppositive(relations: Relation[], input: RelationInput, ci: number): void {
  const b = input.chunks[ci]!
  const opener = tokenLower(input.tokens[b.from]!)

  const indefinite = opener !== null && input.syntax.indefiniteArticles.includes(opener!)
  const definite = opener !== null && input.syntax.definiteArticles.includes(opener!)

  switch (indefinite || definite) {
    case false:
      return
    case true:
      break
  }

  const a = input.chunks.find((c) => c.kind === "NP" && c.to === b.from - 1)

  switch (a === undefined) {
    case true:
      return
    case false:
      break
  }

  // Name-shaped: PROPN, or a capitalized noun — dictionary collisions (`Rei`
  // the king) must not unname a character.
  const anchor = input.tokens[a!.head]!
  const nameShaped =
    anchor.role === "content" &&
    (anchor.tagged.pos === "PROPN" ||
      (anchor.tagged.pos === "NOUN" && /^[A-ZÀ-Ý]/.test(anchor.tagged.token.text)))

  switch (definite && nameShaped === false) {
    case true:
      return
    case false:
      break
  }

  switch (isComma(input.tokens[b.from - 1])) {
    case false:
      return
    case true:
      relations.push(relation("appositive-of", b.head, a!.head, "heuristic"))
      return
  }
}

// The title compound, the appositive's other order: a common-noun NP
// directly abutting a proper-noun NP is a description OF that name — `o
// DETETIVE Rei`, `the DETECTIVE Rei` — the same description->name edge the
// comma appositive builds.
function addTitleAppositive(relations: Relation[], input: RelationInput, ci: number): void {
  const names = input.chunks[ci]!
  const head = input.tokens[names.head]!

  switch (head.role === "content" && head.tagged.pos === "PROPN") {
    case false:
      return
    case true:
      break
  }

  const description = input.chunks.find((c) => c.kind === "NP" && c.to === names.from)

  switch (description === undefined) {
    case true:
      return
    case false:
      break
  }

  const noun = input.tokens[description!.head]!

  switch (noun.role === "content" && noun.tagged.pos === "NOUN") {
    case true:
      relations.push(relation("appositive-of", description!.head, names.head, "heuristic"))
      return
    case false:
      return
  }
}

// The addressed name stands OUTSIDE the clause's argument structure. Two
// shapes: leading — a sentence-initial proper-noun NP closed by a comma
// before a clause that cannot take it as subject (`Daniela, acho que...`,
// where `acho` is 1st person, or a clause with its own subject); trailing — a
// comma-preceded proper noun against the terminal (`Não chore, Daniela.`),
// unless some relation already claimed it (an inverted `dizia Rei` never
// reads as address).
function addVocatives(relations: Relation[], input: RelationInput): void {
  const first = input.chunks[0]

  switch (first !== undefined && first!.kind === "NP" && first!.from === firstContentIndex(input.tokens)) {
    case true:
      addLeadingVocative(relations, input, 0)
      break
    case false:
      break
  }

  addTrailingVocative(relations, input)
}

function firstContentIndex(tokens: readonly AnalyzedToken[]): number {
  for (const [at, token] of tokens.entries()) {
    switch (token.role) {
      case "content":
        return at
      case "punctuation":
        continue
    }
  }

  return -1
}

function addLeadingVocative(relations: Relation[], input: RelationInput, ci: number): void {
  const np = input.chunks[ci]!
  const head = input.tokens[np.head]!

  switch (head.role === "content" && head.tagged.pos === "PROPN" && isComma(input.tokens[np.to])) {
    case false:
      return
    case true:
      break
  }

  const vp = input.chunks.find((c) => c.kind === "VP")

  switch (vp === undefined) {
    case true:
      return
    case false:
      break
  }

  const firstSecondOnly = unambiguousFirstSecond(contentFeat(input.tokens[vp!.head]!), input.syntax.verbFeats)

  const otherSubject = relations.some(
    (r) => r.kind === "subject-of" && r.head === vp!.head && r.dependent !== np.head,
  )

  switch (firstSecondOnly || otherSubject) {
    case false:
      return
    case true:
      break
  }

  for (let at = relations.length - 1; at >= 0; at--) {
    const existing = relations[at]!

    switch (existing.kind === "subject-of" && existing.dependent === np.head) {
      case true:
        relations.splice(at, 1)
        continue
      case false:
        continue
    }
  }

  relations.push(relation("vocative-of", np.head, vp!.head, "heuristic"))
}

function addTrailingVocative(relations: Relation[], input: RelationInput): void {
  for (const [ci, np] of input.chunks.entries()) {
    switch (np.kind === "NP" && np.to - np.from === 1) {
      case false:
        continue
      case true:
        break
    }

    const head = input.tokens[np.head]!

    switch (head.role === "content" && head.tagged.pos === "PROPN") {
      case false:
        continue
      case true:
        break
    }

    const commaBefore = np.from > 0 && isComma(input.tokens[np.from - 1])
    const after = input.tokens[np.to]
    // Trailing (`Não chore, Daniela.`) or mid-sentence between commas
    // (`Sabe, Daniela, que...`).
    const closed =
      after === undefined ||
      (after.role === "punctuation" && (isQuoteTransparentTerminal(after.token.text) || after.token.text === ","))

    switch (commaBefore && closed) {
      case false:
        continue
      case true:
        break
    }

    const claimed = relations.some((r) => r.dependent === np.head || r.head === np.head)

    switch (claimed) {
      case true:
        continue
      case false:
        break
    }

    const vp = lastVpBefore(input.chunks, ci)

    switch (vp.kind) {
      case "none":
        continue
      case "some": {
        const head = input.chunks[vp.value]!.head

        relations.push(relation("vocative-of", np.head, head, "heuristic"))
        addAddresseeSubject(relations, input, np.head, head)
        continue
      }
    }
  }
}

// An imperative's subject IS its addressee: `Não chore, Daniela` — the one
// who shouldn't cry is Daniela. Portuguese imperatives surface as
// imperative- or subjunctive-marked forms; the rule stands down when the
// clause already found a subject.
function addAddresseeSubject(relations: Relation[], input: RelationInput, name: number, head: number): void {
  const sense = verbTense(contentFeat(input.tokens[head]!), input.syntax.verbFeats)

  const directive =
    sense.kind === "some" && (sense.value === "imperative" || sense.value === "subjunctive")

  switch (directive) {
    case false:
      return
    case true:
      break
  }

  const subjected = relations.some((r) => r.kind === "subject-of" && r.head === head)

  switch (subjected) {
    case true:
      return
    case false:
      relations.push(relation("subject-of", name, head, "heuristic"))
      return
  }
}

function isQuoteTransparentTerminal(text: string): boolean {
  switch (text) {
    case ".":
      return true
    case "!":
      return true
    case "?":
      return true
    case "…":
      return true
    default:
      return false
  }
}

function lastVpBefore(chunks: readonly Chunk[], ci: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let k = 0; k < ci; k++) {
    switch (chunks[k]!.kind === "VP") {
      case true:
        best = { kind: "some", value: k }
        continue
      case false:
        continue
    }
  }

  return best
}

function contentFeat(token: AnalyzedToken): string {
  switch (token.role) {
    case "punctuation":
      return ""
    case "content":
      return token.tagged.feat
  }
}

// The possessive relative: in `o homem cujo gato sumiu` / `the man whose cat
// vanished`, the noun after the relative is possessed by the antecedent —
// modifier-of(homem -> gato), the same owner->owned shape the genitive and
// the English 's build.
function addPossessiveRelatives(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    const lower = tokenLower(token)

    switch (lower !== null && input.syntax.possessiveRelatives.includes(lower!)) {
      case false:
        return
      case true:
        break
    }

    const antecedent = antecedentBefore(input, ti)

    switch (antecedent.kind) {
      case "none":
        return
      case "some":
        break
    }

    const possessed = possessedNounAfter(input, ti)

    switch (possessed.kind) {
      case "none":
        return
      case "some":
        relations.push(relation("modifier-of", antecedent.value, possessed.value, "heuristic"))
        return
    }
  })
}

// The noun the possessive relative introduces: the head of its own chunk when
// that chunk is a nominal headed elsewhere (`whose cat` chunks together), or
// the head of the NP directly after it (`cujo` chunks alone as a pronoun).
function possessedNounAfter(input: RelationInput, ti: number): Optional<number> {
  const holder = input.chunks.find((c) => ti >= c.from && ti < c.to)

  switch (holder !== undefined && holder!.kind === "NP" && holder!.head !== ti) {
    case true:
      return { kind: "some", value: holder!.head }
    case false:
      break
  }

  const next = input.chunks.find((c) => c.kind === "NP" && c.from === ti + 1)

  switch (next === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: next!.head }
  }
}

// The comparative scaffold: an adjective under a degree adverb (`mais alto`,
// `more beautiful`) or carrying comparative morphology (`darker`, AGID CMP),
// followed by the standard marker and its NP — the standard is what the
// quality is measured against. One genitive-marker token may sit between
// adjective and marker for the Portuguese `do que` contraction.
function addComparatives(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    switch (token.role === "content" && token.tagged.pos === "ADJ") {
      case false:
        return
      case true:
        break
    }

    const degreeBefore = ti > 0 && hasDegreeAdverb(input, ti - 1)
    const morphological = contentFeat(token).startsWith("COMP")

    switch (degreeBefore || morphological) {
      case false:
        return
      case true:
        break
    }

    let at = ti + 1
    const next = input.tokens[at]
    const between = next === undefined ? null : tokenLower(next)

    switch (between !== null && input.syntax.genitiveMarkers.includes(between!)) {
      case true:
        at++
        break
      case false:
        break
    }

    const marker = input.tokens[at]

    switch (marker !== undefined && tokenLower(marker!) !== null && input.syntax.thanMarkers.includes(tokenLower(marker!)!)) {
      case false:
        return
      case true:
        break
    }

    const standard = firstChunkFrom(input.chunks, at + 1)

    switch (standard.kind) {
      case "none":
        return
      case "some":
        break
    }

    const chunk = input.chunks[standard.value]!

    switch (punctuationBetween(input.tokens, at + 1, chunk.from)) {
      case true:
        return
      case false:
        relations.push(relation("compared-to", chunk.head, ti, "heuristic"))
        return
    }
  })
}

function hasDegreeAdverb(input: RelationInput, at: number): boolean {
  const lower = tokenLower(input.tokens[at]!)

  return lower !== null && input.syntax.degreeAdverbs.includes(lower)
}

// An adverbial subordinate clause: a declared subordinator opening a clause
// whose verb hangs off the matrix verb — `Chorou QUANDO o gato sumiu`,
// `QUANDO a noite caiu, Rei saiu`. Mirrors the complement-of convention: the
// dependent is the subordinator token, the clause's left edge. The `se`
// homograph is position-gated: only a sentence-initial or post-punctuation
// `se` subordinates (a verb-adjacent one is the clitic).
function addSubordinateClauses(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    const lower = tokenLower(token)

    switch (lower !== null && input.syntax.subordinators.includes(lower!)) {
      case false:
        return
      case true:
        break
    }

    switch (lower === "se" && procliticPosition(input, ti)) {
      case true:
        return
      case false:
        break
    }

    const embedded = input.chunks.find((c) => c.kind === "VP" && c.from > ti)

    switch (embedded === undefined || terminalBetween(input.tokens, ti, embedded!.from)) {
      case true:
        return
      case false:
        break
    }

    const matrix = matrixFor(input, ti, embedded!)

    switch (matrix.kind) {
      case "none":
        return
      case "some":
        break
    }

    switch (matrix.value === embedded!.head) {
      case true:
        return
      case false:
        relations.push(relation("adverbial-of", ti, matrix.value, "heuristic"))
        return
    }
  })
}

function procliticPosition(input: RelationInput, ti: number): boolean {
  const before = ti - 1

  return before >= 0 && input.tokens[before]!.role === "content"
}

// The matrix verb the subordinate clause modifies: the last VP before the
// subordinator (`Chorou quando...`), or — for a clause-initial subordinator —
// the first VP after the comma that closes the clause (`Quando a noite caiu,
// Rei saiu`).
function matrixFor(input: RelationInput, ti: number, embedded: Chunk): Optional<number> {
  let before: Optional<number> = { kind: "none" }

  for (const chunk of input.chunks) {
    switch (chunk.kind === "VP" && chunk.to <= ti) {
      case true:
        before = { kind: "some", value: chunk.head }
        continue
      case false:
        continue
    }
  }

  switch (before.kind) {
    case "some":
      return before
    case "none":
      break
  }

  const close = nextComma(input.tokens, embedded.to)

  switch (close.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      break
  }

  const matrix = input.chunks.find((c) => c.kind === "VP" && c.from > close.value)

  switch (matrix === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: matrix!.head }
  }
}

// Right-node raising, forward only: in `comprou e leu o livro` the first
// conjunct is objectless and the second carries the shared object — the CONJ
// gap says they read it together. The backward shape (`comprou o livro e
// leu`) is an elision, not sharing, and stays with the discourse pass.
function addSharedObjects(relations: Relation[], input: RelationInput): void {
  input.chunks.forEach((chunk, ci) => {
    switch (chunk.kind === "VP" && conjJoinsPreviousClause(input, ci)) {
      case false:
        return
      case true:
        break
    }

    const previous = previousVp(input.chunks, ci)

    switch (previous.kind) {
      case "none":
        return
      case "some":
        break
    }

    const prevHead = input.chunks[previous.value]!.head

    switch (takesObject(verbLemma(input.tokens, input.chunks[previous.value]!), input.syntax.valency)) {
      case false:
        return
      case true:
        break
    }

    const prevClaimed = relations.some(
      (r) => (r.kind === "object-of" || r.kind === "complement-of") && r.head === prevHead,
    )

    switch (prevClaimed) {
      case true:
        return
      case false:
        break
    }

    const shared = relations.find((r) => r.kind === "object-of" && r.head === chunk.head)

    switch (shared === undefined) {
      case true:
        return
      case false:
        relations.push(relation("object-of", shared!.dependent, prevHead, "heuristic"))
        return
    }
  })
}

// The quote IS what the dicendi verb says: when the attribution inverted
// (`..., dizia Rei` — subject after the verb, punctuation directly before
// it), the sentence content before the boundary becomes the verb's clausal
// complement, dependent on its leftmost content token, the same convention
// complement-of always uses.
function addQuoteContent(relations: Relation[], input: RelationInput): void {
  input.chunks.forEach((chunk) => {
    switch (chunk.kind === "VP" && input.syntax.dicendi.includes(verbLemma(input.tokens, chunk))) {
      case false:
        return
      case true:
        break
    }

    const inverted = relations.some(
      (r) => r.kind === "subject-of" && r.head === chunk.head && r.dependent > chunk.head,
    )

    const claimed = relations.some((r) => r.kind === "complement-of" && r.head === chunk.head)

    switch (inverted && claimed === false) {
      case false:
        return
      case true:
        break
    }

    const boundary = chunk.from - 1

    switch (boundary >= 0 && input.tokens[boundary]!.role === "punctuation") {
      case false:
        return
      case true:
        break
    }

    const first = firstContentIndex(input.tokens)

    switch (first >= 0 && first < boundary) {
      case true:
        relations.push(relation("complement-of", first, chunk.head, "heuristic"))
        return
      case false:
        return
    }
  })
}

// A sentence-opening time NP closed by a comma frames the whole clause:
// `Uma vez, ao sair do ônibus, encontrei...` — temporal-of(vez -> encontrei).
function addTemporalOpeners(relations: Relation[], input: RelationInput): void {
  const first = input.chunks[0]

  switch (first !== undefined && first!.kind === "NP" && isComma(input.tokens[first!.to])) {
    case false:
      return
    case true:
      break
  }

  const head = input.tokens[first!.head]!

  switch (head.role === "content" && input.syntax.temporalNouns.includes(head.tagged.lemma.toLowerCase())) {
    case false:
      return
    case true:
      break
  }

  const vp = input.chunks.find((c) => c.kind === "VP")

  switch (vp === undefined) {
    case true:
      return
    case false:
      relations.push(relation("temporal-of", first!.head, vp!.head, "heuristic"))
      return
  }
}

// ─── adjuncts, degrees, roles, purposes ──────────────────────────────────────
// Adverbs finally bind: a declared intensifier or degree word directly
// before an adjective grades it (degree-of: `muito alto`, `mais alto`);
// every other free adverb attaches to its verb (advmod-of) — the previous
// verb when it trails one (`correu desesperadamente`), the next when it
// leads (`sempre escrevia`). Function words that other passes own (negators,
// relatives, subordinators, connectives, degree words themselves) stay out.
function addAdverbAttachment(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    switch (token.role) {
      case "punctuation":
        return
      case "content":
        break
    }

    const lower = tokenLower(token)!

    // Degree words match by SURFACE — the tagger sometimes hands `muito`/
    // `mais` a determiner or noun reading, and the grading relation must not
    // care.
    const degreeWord =
      input.syntax.intensifiers.includes(lower) || input.syntax.degreeAdverbs.includes(lower)

    const next = input.tokens[ti + 1]
    const gradesAdjective =
      degreeWord && next !== undefined && next.role === "content" && next.tagged.pos === "ADJ"

    switch (gradesAdjective) {
      case true:
        relations.push(relation("degree-of", ti, ti + 1, "heuristic"))
        return
      case false:
        break
    }

    switch (token.tagged.pos === "ADV" && degreeWord === false && functionAdverb(lower, input.syntax) === false) {
      case false:
        return
      case true:
        break
    }

    const host = adverbHost(input, ti)

    switch (host.kind) {
      case "none":
        return
      case "some":
        relations.push(relation("advmod-of", ti, host.value, "heuristic"))
        return
    }
  })
}

function functionAdverb(lower: string, syntax: SyntaxData): boolean {
  return (
    syntax.negators.includes(lower) ||
    syntax.relativePronouns.includes(lower) ||
    syntax.relativePlaceAdverbs.includes(lower) ||
    syntax.subordinators.includes(lower) ||
    syntax.complementizers.includes(lower) ||
    syntax.thanMarkers.includes(lower) ||
    syntax.timeConnectives.some((c) => c.form === lower) ||
    syntax.discourseMarkers.some((c) => c.form === lower) ||
    syntax.interrogativeAdverbs.includes(lower)
  )
}

// The verb an adverb rides: the VP ending directly at it wins (`correu
// rapidamente`), else the VP starting within two tokens after it (`sempre
// escrevia`, `nunca mais voltou`), else the nearest preceding VP.
function adverbHost(input: RelationInput, ti: number): Optional<number> {
  const trailing = input.chunks.find((c) => c.kind === "VP" && c.to === ti)

  switch (trailing === undefined) {
    case false:
      return { kind: "some", value: trailing!.head }
    case true:
      break
  }

  const leading = input.chunks.find((c) => c.kind === "VP" && c.from > ti && c.from <= ti + 3)

  switch (leading === undefined) {
    case false:
      return { kind: "some", value: leading!.head }
    case true:
      break
  }

  return lastVpHeadEndingBefore(input, ti)
}

function lastVpHeadEndingBefore(input: RelationInput, ti: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (const chunk of input.chunks) {
    switch (chunk.kind === "VP" && chunk.to <= ti) {
      case true:
        best = { kind: "some", value: chunk.head }
        continue
      case false:
        continue
    }
  }

  return best
}

// The superlative's comparison set: `o mais alto DA CIDADE`, `the tallest
// OF THE TOWN` — a definite degree phrase (article + degree adverb + ADJ, or
// an en SUP-marked adjective) whose following genitive names the domain.
function addSuperlativeDomains(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    switch (token.role === "content" && token.tagged.pos === "ADJ") {
      case false:
        return
      case true:
        break
    }

    const analytic =
      ti >= 2 &&
      hasDegreeAdverb(input, ti - 1) &&
      tokenLower(input.tokens[ti - 2]!) !== null &&
      input.syntax.definiteArticles.includes(tokenLower(input.tokens[ti - 2]!)!)

    const morphological = contentFeat(token).startsWith("SUP")

    switch (analytic || morphological) {
      case false:
        return
      case true:
        break
    }

    const opener = input.tokens[ti + 1]
    const openerLower = opener === undefined ? null : tokenLower(opener)

    switch (openerLower !== null && input.syntax.genitiveMarkers.includes(openerLower!)) {
      case false:
        return
      case true:
        break
    }

    // The genitive may itself open the domain's chunk (`da cidade` is a PP
    // from ti+1), so the search starts at the marker.
    const domain = firstChunkFrom(input.chunks, ti + 1)

    switch (domain.kind) {
      case "none":
        return
      case "some": {
        const chunk = input.chunks[domain.value]!

        switch (punctuationBetween(input.tokens, ti + 1, chunk.from)) {
          case true:
            return
          case false:
            relations.push(relation("compared-to", chunk.head, ti, "heuristic"))
            return
        }
      }
    }
  })
}

// The object predicative: for a declared verb (`achar`, `deixar`, `find`,
// `leave`), an adjective trailing the object predicates the OBJECT — `achou
// a casa VAZIA` found it empty, it did not find an empty house. The
// adjective sits inside the object NP in Portuguese (the trailing-ADJ chunk
// slot) or directly after it in English.
function addObjectPredicatives(relations: Relation[], input: RelationInput): void {
  for (const r of [...relations]) {
    switch (r.kind === "object-of") {
      case false:
        continue
      case true:
        break
    }

    const verb = input.tokens[r.head]!

    switch (verb.role === "content" && input.syntax.objectPredicativeVerbs.includes(verb.tagged.lemma)) {
      case false:
        continue
      case true:
        break
    }

    const np = input.chunks.find((c) => c.kind === "NP" && c.head === r.dependent)

    switch (np === undefined) {
      case true:
        continue
      case false:
        break
    }

    const inside = lastAdjectiveIn(input, np!.head + 1, np!.to)

    switch (inside.kind) {
      case "some":
        relations.push(relation("predicative-of", inside.value, r.dependent, "heuristic"))
        continue
      case "none":
        break
    }

    const after = input.tokens[np!.to]

    switch (after !== undefined && after!.role === "content" && after!.tagged.pos === "ADJ") {
      case true:
        relations.push(relation("predicative-of", np!.to, r.dependent, "heuristic"))
        continue
      case false:
        continue
    }
  }
}

function lastAdjectiveIn(input: RelationInput, from: number, to: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let at = from; at < to; at++) {
    const token = input.tokens[at]!

    switch (token.role === "content" && token.tagged.pos === "ADJ") {
      case true:
        best = { kind: "some", value: at }
        continue
      case false:
        continue
    }
  }

  return best
}

// The role predicate: a declared role marker after a verb hands its noun to
// the verb's subject as a ROLE — `trabalhava como DETETIVE`, `worked as a
// DETECTIVE`.
function addRolePredicates(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    const lower = tokenLower(token)

    switch (lower !== null && input.syntax.roleMarkers.includes(lower!)) {
      case false:
        return
      case true:
        break
    }

    const vp = lastVpEndingBefore(input, ti)

    switch (vp.kind) {
      case "none":
        return
      case "some":
        break
    }

    const np = firstChunkFrom(input.chunks, ti + 1)

    switch (np.kind) {
      case "none":
        return
      case "some":
        break
    }

    const chunk = input.chunks[np.value]!
    const head = input.tokens[chunk.head]!

    const nominal =
      chunk.kind === "NP" &&
      head.role === "content" &&
      head.tagged.pos === "NOUN" &&
      punctuationBetween(input.tokens, ti + 1, chunk.from) === false

    switch (nominal) {
      case true: {
        // The role noun is not the verb's object — displace the positional
        // guess (`trabalhava como detetive` works AS one, takes no one).
        for (let k = relations.length - 1; k >= 0; k--) {
          const existing = relations[k]!

          switch (existing.kind === "object-of" && existing.dependent === chunk.head && existing.head === vp.value) {
            case true:
              relations.splice(k, 1)
              continue
            case false:
              continue
          }
        }

        relations.push(relation("role-of", chunk.head, vp.value, "heuristic"))
        return
      }
      case false:
        return
    }
  })
}

function lastVpEndingBefore(input: RelationInput, ti: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (const chunk of input.chunks) {
    switch (chunk.kind === "VP" && chunk.to <= ti) {
      case true:
        best = { kind: "some", value: chunk.head }
        continue
      case false:
        continue
    }
  }

  return best
}

// The purpose infinitive: `saiu PARA COMPRAR pão` — a declared purpose
// marker followed by an infinitive binds it to the matrix as its goal. In
// English every infinitive wears `to`, so the rule additionally demands an
// object-REJECTING matrix (`went to buy bread` fires; `wanted to leave` is a
// complement, not a purpose).
function addPurposeInfinitives(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    const lower = tokenLower(token)

    switch (lower !== null && input.syntax.purposeMarkers.includes(lower!)) {
      case false:
        return
      case true:
        break
    }

    const verbAt = ti + 1
    const verb = input.tokens[verbAt]

    switch (verb !== undefined && verb!.role === "content" && verb!.tagged.pos === "VERB") {
      case false:
        return
      case true:
        break
    }

    const marked = isInfinitive(verb as AnalyzedToken, input.syntax.verbFeats)
    const bare = input.syntax.verbFeats.infinitivePrefixes.length === 0

    switch (marked || bare) {
      case false:
        return
      case true:
        break
    }

    const matrix = lastVpEndingBefore(input, ti)

    switch (matrix.kind) {
      case "none":
        return
      case "some":
        break
    }

    switch (bare && takesObject(verbLemma(input.tokens, vpOfHead(input, matrix.value)), input.syntax.valency)) {
      case true:
        return
      case false:
        relations.push(relation("purpose-of", verbAt, matrix.value, "heuristic"))
        return
    }
  })
}

function vpOfHead(input: RelationInput, head: number): Chunk {
  const found = input.chunks.find((c) => c.kind === "VP" && c.head === head)

  switch (found === undefined) {
    case true:
      return { kind: "VP", from: head, to: head + 1, head }
    case false:
      return found!
  }
}

// The interval adjunct, by token scan (chunking splits `por dois anos`
// unhelpfully): a duration marker with a temporal noun within reach binds
// that noun to the nearest preceding verb as duration-of, displacing any
// point-in-time reading other passes minted for the phrase.
function addDurationOpeners(relations: Relation[], input: RelationInput): void {
  input.tokens.forEach((token, ti) => {
    const lower = tokenLower(token)

    switch (lower !== null && input.syntax.durationMarkers.includes(lower!)) {
      case false:
        return
      case true:
        break
    }

    for (let at = ti + 1; at <= ti + 3 && at < input.tokens.length; at++) {
      const candidate = input.tokens[at]!

      switch (candidate.role) {
        case "punctuation":
          return
        case "content":
          break
      }

      switch (input.syntax.temporalNouns.includes(candidate.tagged.lemma.toLowerCase())) {
        case false:
          continue
        case true:
          break
      }

      const vp = lastVpHeadEndingBefore(input, ti)

      switch (vp.kind) {
        case "none":
          return
        case "some":
          break
      }

      for (let k = relations.length - 1; k >= 0; k--) {
        const existing = relations[k]!

        const stale =
          (existing.kind === "temporal-of" || existing.kind === "modifier-of") &&
          existing.dependent >= ti &&
          existing.dependent <= at

        switch (stale) {
          case true:
            relations.splice(k, 1)
            continue
          case false:
            continue
        }
      }

      relations.push(relation("duration-of", at, vp.value, "heuristic"))
      return
    }
  })
}

// A fronted adjunct interrogative binds to the clause's verb: `ONDE ele
// mora?`, `WHY did she leave?` — advmod-of, the same edge a bound adverb
// earns.
function addWhAdjuncts(relations: Relation[], input: RelationInput): void {
  switch (isInterrogative(input.tokens)) {
    case false:
      return
    case true:
      break
  }

  const first = firstContentIndex(input.tokens)

  switch (first >= 0) {
    case false:
      return
    case true:
      break
  }

  const lower = tokenLower(input.tokens[first]!)

  switch (lower !== null && input.syntax.interrogativeAdverbs.includes(lower!)) {
    case false:
      return
    case true:
      break
  }

  const vp = input.chunks.find((c) => c.kind === "VP")

  switch (vp === undefined) {
    case true:
      return
    case false:
      relations.push(relation("advmod-of", first, vp!.head, "heuristic"))
      return
  }
}

// The polarity pass: a declared negator riding a VP (inside it before the
// head — `did not see` — or directly before it across at most adverbs —
// `não era`, `nunca mais voltou`) flips every relation that VP heads, and
// the flip follows complement chains onto chained verb forms
// (`não era compartilhada`).
function applyPolarity(relations: readonly Relation[], input: RelationInput): readonly Relation[] {
  const negated = new Set<number>()

  for (const chunk of input.chunks) {
    switch (chunk.kind) {
      case "VP":
        break
      case "NP":
        continue
      case "PP":
        continue
    }

    switch (negatorTouches(input, chunk)) {
      case true:
        negated.add(chunk.head)
        break
      case false:
        break
    }
  }

  // Negation also arrives from ARGUMENT position: `Ninguém veio`, `nothing
  // remained`, `no cat came` — a negative indefinite inside any dependent's
  // chunk (or directly before the verb) flips the clause. Concord for free:
  // `não vi nada` is already negated once, and once is all polarity carries.
  for (const r of relations) {
    switch (r.kind === "subject-of" || r.kind === "object-of" || r.kind === "dative-of") {
      case false:
        continue
      case true:
        break
    }

    switch (negativeIndefiniteAt(input, r.dependent)) {
      case true:
        negated.add(r.head)
        continue
      case false:
        continue
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    for (const r of relations) {
      const chained = r.kind === "complement-of" && negated.has(r.head) && isVerbToken(input.tokens[r.dependent]!)

      switch (chained) {
        case true:
          negated.add(r.dependent)
          break
        case false:
          break
      }
    }
  }

  return relations.map((r) => {
    switch (negated.has(r.head)) {
      case true:
        return { ...r, polarity: "negative" as const }
      case false:
        return r
    }
  })
}

function negatorTouches(input: RelationInput, chunk: Chunk): boolean {
  for (let at = chunk.from; at < chunk.head; at++) {
    switch (isNegator(input, at)) {
      case true:
        return true
      case false:
        continue
    }
  }

  let at = chunk.from - 1
  let steps = 0

  while (at >= 0 && steps < 3) {
    const token = input.tokens[at]!

    switch (token.role) {
      case "punctuation":
        return false
      case "content":
        break
    }

    switch (isNegator(input, at)) {
      case true:
        return true
      case false:
        break
    }

    switch (token.tagged.pos === "ADV") {
      case true:
        at--
        steps++
        continue
      case false:
        return false
    }
  }

  return false
}

function isNegator(input: RelationInput, at: number): boolean {
  const lower = tokenLower(input.tokens[at]!)

  return lower !== null && input.syntax.negators.includes(lower)
}

// The dependent token, or any token of the chunk holding it, is a declared
// negative indefinite (`nenhum` sits inside the NP whose head subjects the
// verb).
function negativeIndefiniteAt(input: RelationInput, dependent: number): boolean {
  const holder = input.chunks.find((c) => dependent >= c.from && dependent < c.to)
  const from = holder === undefined ? dependent : holder.from
  const to = holder === undefined ? dependent + 1 : holder.to

  for (let at = from; at < to; at++) {
    const lower = tokenLower(input.tokens[at]!)

    switch (lower !== null && input.syntax.negativeIndefinites.includes(lower!)) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

function isVerbToken(token: AnalyzedToken): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return token.tagged.pos === "VERB"
  }
}

// Maximal runs of adjacent NP chunks whose pairwise gap is exactly one token —
// a conjunction or a list comma — with at least one conjunction link overall.
function coordinatedNpGroups(input: RelationInput): readonly (readonly number[])[] {
  const groups: number[][] = []

  let current: number[] = []
  let hasConj = false

  const close = (): void => {
    switch (current.length >= 2 && hasConj) {
      case true:
        groups.push(current)
        break
      case false:
        break
    }

    current = []
    hasConj = false
  }

  input.chunks.forEach((chunk, ci) => {
    switch (chunk.kind) {
      case "NP":
        break
      case "VP":
        close()
        return
      case "PP":
        close()
        return
    }

    switch (current.length === 0) {
      case true:
        current = [ci]
        return
      case false:
        break
    }

    const previous = input.chunks[current[current.length - 1]!]!
    const link = coordinationLink(input.tokens, previous.to, chunk.from)

    switch (link) {
      case "conj":
        hasConj = true
        current.push(ci)
        return
      case "comma":
        current.push(ci)
        return
      case "none":
        close()
        current = [ci]
        return
    }
  })

  close()

  return groups
}

type CoordinationLink = "conj" | "comma" | "none"

function coordinationLink(tokens: readonly AnalyzedToken[], from: number, to: number): CoordinationLink {
  switch (to - from === 1) {
    case false:
      return "none"
    case true:
      break
  }

  const between = tokens[from]!

  switch (between.role) {
    case "punctuation":
      switch (between.token.text === ",") {
        case true:
          return "comma"
        case false:
          return "none"
      }
    case "content":
      switch (between.tagged.pos === "CONJ") {
        case true:
          return "conj"
        case false:
          return "none"
      }
  }
}

function npContaining(chunks: readonly Chunk[], tokens: readonly number[]): Optional<number> {
  for (const [ci, chunk] of chunks.entries()) {
    const holds = chunk.kind === "NP" && coversAll(chunk, tokens)

    switch (holds) {
      case true:
        return { kind: "some", value: ci }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

function coversAll(chunk: Chunk, tokens: readonly number[]): boolean {
  return tokens.every((t) => t >= chunk.from && t < chunk.to)
}

function nearestVp(chunks: readonly Chunk[], npIndex: number): Optional<number> {
  const np = chunks[npIndex]!

  let best: Optional<number> = { kind: "none" }
  let bestDistance = Number.POSITIVE_INFINITY

  chunks.forEach((chunk, ci) => {
    switch (chunk.kind === "VP") {
      case false:
        return
      case true:
        break
    }

    const distance = Math.abs(chunk.head - np.head)

    switch (distance < bestDistance) {
      case true:
        best = { kind: "some", value: ci }
        bestDistance = distance
        return
      case false:
        return
    }
  })

  return best
}

function nearestNpBefore(chunks: readonly Chunk[], ci: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let k = 0; k < ci; k++) {
    switch (chunks[k]!.kind === "NP") {
      case true:
        best = { kind: "some", value: k }
        continue
      case false:
        continue
    }
  }

  return best
}

function nearestAnchorBefore(chunks: readonly Chunk[], ci: number): Optional<number> {
  let best: Optional<number> = { kind: "none" }

  for (let k = 0; k < ci; k++) {
    switch (chunks[k]!.kind) {
      case "NP":
        best = { kind: "some", value: k }
        continue
      case "VP":
        best = { kind: "some", value: k }
        continue
      case "PP":
        continue
    }
  }

  return best
}

function takesObject(lemma: string, valency: readonly ValencyHint[]): boolean {
  const frame = frameOf(lemma, valency)

  switch (frame.kind) {
    case "none":
      return true
    case "some":
      return frameTakesObject(frame.value)
  }
}

function frameTakesObject(frame: ValencyFrame): boolean {
  switch (frame) {
    case "transitive":
      return true
    case "ditransitive":
      return true
    case "intransitive":
      return false
    case "copular":
      return false
    case "prepositional":
      return false
    case "presentational":
      return false
  }
}

function frameOf(lemma: string, valency: readonly ValencyHint[]): Optional<ValencyFrame> {
  const hit = valency.find((v) => v.lemma === lemma)

  switch (hit === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: hit!.frame }
  }
}

function verbLemma(tokens: readonly AnalyzedToken[], vp: Chunk): string {
  const token = tokens[vp.head]!

  switch (token.role) {
    case "content":
      return token.tagged.lemma
    case "punctuation":
      return ""
  }
}

function isAdjective(token: AnalyzedToken): boolean {
  switch (token.role) {
    case "content":
      return token.tagged.pos === "ADJ"
    case "punctuation":
      return false
  }
}

function relation(kind: RelationKind, dependent: number, head: number, provenance: RelationProvenance): Relation {
  return { kind, dependent, head, provenance, polarity: "affirmative" }
}
