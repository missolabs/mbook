// Rule-based shallow dependencies over one sentence's chunks: subject-of,
// object-of, complement-of and modifier-of. This is a clause-level positional
// pass — both supported languages are SVO, so one engine with no per-language
// parameters covers them — refined by data-driven gates from SyntaxData:
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
// heads, or the modifier token itself), the same coordinate the chunker and
// glyph anchors use. A complement-of's dependent is the LEFTMOST token of the
// complement — the complementizer for a clausal complement, the infinitive verb
// itself for an infinitival chain. That token always exists when the relation
// fires and marks the complement's left edge exactly, so its span is
// [dependent, sentence end) without pretending the embedded predicate was
// found; the embedded clause's own VP still earns its own subject/object
// relations.

import type { Chunk } from "./chunk"
import type { AnalyzedToken } from "./tag"
import type { SyntaxData, ValencyFrame, ValencyHint, VerbFeatMarks } from "./model"
import type { Optional } from "../optional"

export type RelationKind =
  | "subject-of"
  | "object-of"
  | "complement-of"
  | "modifier-of"
  | "predicate-of"
  | "agent-of"

export type RelationProvenance = "heuristic" | "pinned"

export type Relation = {
  kind: RelationKind
  dependent: number
  head: number
  provenance: RelationProvenance
}

// A resolved subject-mention's covered token indices in this sentence.
export type SubjectPin = { tokens: readonly number[] }

export type RelationInput = {
  tokens: readonly AnalyzedToken[]
  chunks: readonly Chunk[]
  pins: readonly SubjectPin[]
  syntax: SyntaxData
}

export function buildRelations(input: RelationInput): readonly Relation[] {
  const pinnedSubjects = resolvePins(input.chunks, input.pins)

  const relations: Relation[] = []

  input.chunks.forEach((chunk, ci) => {
    switch (chunk.kind) {
      case "VP":
        addSubject(relations, input, ci, pinnedSubjects)
        addComplementOrObject(relations, input, ci, pinnedSubjects)
        addPredicate(relations, input, ci, pinnedSubjects)
        addPresentationalSubject(relations, input, ci, pinnedSubjects)
        addInfinitiveChain(relations, input, ci)
        addParticipleChain(relations, input, ci)
        return
      case "NP":
        addModifiers(relations, input.tokens, chunk)
        addPossessive(relations, input, ci)
        return
      case "PP":
        addAttachment(relations, input, ci)
        return
    }
  })

  expandCoordination(relations, input)

  return relations
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

  const np = nearestNpBefore(chunks, ci)

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

  const dependent = resolveRelative(input, np.value)

  relations.push(relation("subject-of", dependent, chunks[ci]!.head, "heuristic"))
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

// The gap between this VP and the chunk before it is exactly one conjunction
// token — the `e` / `and` that coordinates it into the previous clause.
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

  switch (to - from === 1) {
    case false:
      return false
    case true:
      break
  }

  const between = input.tokens[from]!

  switch (between.role) {
    case "punctuation":
      return false
    case "content":
      return between.tagged.pos === "CONJ"
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
function resolveRelative(input: RelationInput, npIndex: number): number {
  const np = input.chunks[npIndex]!

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

function isRelativePronoun(token: AnalyzedToken, relativePronouns: readonly string[]): boolean {
  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return relativePronouns.includes(token.tagged.token.text.toLowerCase())
  }
}

// What the verb takes, looked for to its right past any parentheticals: the
// declared complementizer opens a clausal complement, and only failing that is
// an NP read as the direct object — the two are exclusive, since material after
// the complementizer belongs to the embedded clause.
function addComplementOrObject(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  switch (takesObject(verbLemma(input.tokens, input.chunks[ci]!), input.syntax.valency)) {
    case false:
      return
    case true:
      break
  }

  const start = afterParentheticals(input.tokens, input.chunks[ci]!.to)

  switch (isComplementizer(input.tokens[start], input.syntax.complementizers)) {
    case true:
      relations.push(relation("complement-of", start, input.chunks[ci]!.head, "heuristic"))
      return
    case false:
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

function punctuationBetween(tokens: readonly AnalyzedToken[], from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = tokens[at]!

    switch (token.role) {
      case "punctuation":
        return true
      case "content":
        continue
    }
  }

  return false
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
// One PP outranks that default — the agent of a passive (`comido pelo gato`,
// `seen by the sailor`): its adposition is a declared agent marker and its
// anchor is a passive participle, so the edge is `agent-of`, the relation the
// "who did it" graph question reads.
function addAttachment(relations: Relation[], input: RelationInput, ci: number): void {
  const anchor = nearestAnchorBefore(input.chunks, ci)

  switch (anchor.kind) {
    case "none":
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
      relations.push(relation("modifier-of", input.chunks[ci]!.head, input.chunks[anchor.value]!.head, "heuristic"))
      return
  }
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
  return { kind, dependent, head, provenance }
}
