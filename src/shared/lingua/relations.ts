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

export type RelationKind = "subject-of" | "object-of" | "complement-of" | "modifier-of"

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
        addSubject(relations, input.chunks, ci, pinnedSubjects)
        addComplementOrObject(relations, input, ci, pinnedSubjects)
        addPresentationalSubject(relations, input, ci, pinnedSubjects)
        addInfinitiveChain(relations, input, ci)
        return
      case "NP":
        addModifiers(relations, input.tokens, chunk)
        return
      case "PP":
        addAttachment(relations, input.chunks, ci)
        return
    }
  })

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

function addSubject(relations: Relation[], chunks: readonly Chunk[], ci: number, pins: Pins): void {
  const pinned = pins.get(ci)

  switch (pinned === undefined) {
    case false:
      relations.push(relation("subject-of", chunks[pinned!]!.head, chunks[ci]!.head, "pinned"))
      return
    case true:
      break
  }

  const np = nearestNpBefore(chunks, ci)

  switch (np.kind) {
    case "none":
      return
    case "some":
      relations.push(relation("subject-of", chunks[np.value]!.head, chunks[ci]!.head, "heuristic"))
      return
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

// A presentational (unaccusative/existential) verb takes a POSTVERBAL subject:
// `Aqui só existe o vento` predicates existence OF the wind, so the first NP
// after the verb is its subject, not its object — but only when no NP precedes
// the verb (a preverbal NP already claimed the subject slot: `o verão existe
// mesmo aí`) and no pin already named one. Same hop-and-boundary discipline as
// the object rule: parentheticals are crossed, other punctuation is a clause
// boundary.
function addPresentationalSubject(relations: Relation[], input: RelationInput, ci: number, pins: Pins): void {
  const lemma = verbLemma(input.tokens, input.chunks[ci]!)
  const frame = frameOf(lemma, input.syntax.valency)

  switch (frame.kind === "some" && frame.value === "presentational") {
    case false:
      return
    case true:
      break
  }

  switch (pins.get(ci) === undefined && nearestNpBefore(input.chunks, ci).kind === "none") {
    case false:
      return
    case true:
      break
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
function addAttachment(relations: Relation[], chunks: readonly Chunk[], ci: number): void {
  const anchor = nearestAnchorBefore(chunks, ci)

  switch (anchor.kind) {
    case "none":
      return
    case "some":
      relations.push(relation("modifier-of", chunks[ci]!.head, chunks[anchor.value]!.head, "heuristic"))
      return
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
