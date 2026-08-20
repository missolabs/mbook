// The timeline pass — deterministic event ordering, the ninth pass. In
// compiler terms this is dependence analysis over the bound IR: events are VP
// heads admitted by tense, edges come from a CLOSED rule list, and where no
// rule fires there is NO edge — the output is a partial order, never a guess.
// The machinery is Reichenbach's tense model plus the DRT narrative
// convention, both fully rule-based:
//   * a PERFECTIVE past event ADVANCES the reference time — successive
//     perfectives chain (`Chegou. Sentou. Abriu.` -> chegou < sentou < abriu);
//   * an IMPERFECTIVE is a background state OVERLAPPING the reference event
//     (`Chovia. Rei entrou.` -> entrou during chovia);
//   * a PLUPERFECT (or a perfect chain onto ter/haver/have) is a FLASHBACK —
//     before the reference time, advancing nothing;
//   * futures/prospection land after the reference time, advancing nothing;
//   * present-tense narration is narrator commentary (offline), subjunctives,
//     conditionals and other moods are irrealis, negated clauses are
//     non-events, and speech-attributed sentences live on their own lane —
//     none of these order anything.
// Declared connectives override the defaults: a temporal subordinator's
// clause orders by its `subordinatorTime` entry instead of joining the chain
// (`Chorou quando o gato sumiu` — sumiu MEETS chorou, not after it), and a
// sentence-initial retreat adverb (`Antes, ...`) flips the sentence's first
// perfective to land before the reference time.
//
// Determinism: every edge is a function of already-deterministic IR plus
// dictionary data, each carries the rule that minted it, and the tense senses
// are normalized by `tenseSenses` — so these rules are language-independent.

import type { Optional } from "../optional"
import type { Chunk } from "./parser"
import type { Sentence } from "./pipeline"
import type { SyntaxData } from "./model"
import { verbTense } from "./model"

export type TimelineLane = "narrative" | "speech" | "offline" | "irrealis" | "negated"

export type TimelineEffect = "perfective" | "stative" | "anterior" | "posterior" | "none"

export type TimelineEvent = {
  sentence: number
  token: number
  lane: TimelineLane
  sense: string
  effect: TimelineEffect
}

export type TimelineEdgeKind = "before" | "meets" | "during"

export type TimelineProvenance = "narrative-advance" | "tense-anaphora" | "connective" | "prospection"

// `before(a, b)`: a happens before b. `meets(a, b)`: a ends where b begins.
// `during(a, b)`: a happens inside the span of b.
export type TimelineEdge = {
  kind: TimelineEdgeKind
  fromSentence: number
  fromToken: number
  toSentence: number
  toToken: number
  provenance: TimelineProvenance
}

export type Timeline = {
  events: readonly TimelineEvent[]
  edges: readonly TimelineEdge[]
}

export type TimelineInput = {
  sentences: readonly Sentence[]
  syntax: SyntaxData
}

type Anchor = { sentence: number; token: number }

export function buildTimeline(input: TimelineInput): Timeline {
  const events: TimelineEvent[] = []
  const edges: TimelineEdge[] = []

  let reference: Optional<Anchor> = { kind: "none" }
  const pendingStatives: Anchor[] = []
  const pendingAnteriors: Anchor[] = []

  input.sentences.forEach((sentence, si) => {
    const embedded = embeddedClauseHeads(sentence)
    let retreatArmed = sentenceRetreats(sentence, input.syntax)

    for (const chunk of sentence.chunks) {
      switch (chunk.kind) {
        case "VP":
          break
        case "NP":
          continue
        case "PP":
          continue
      }

      const admitted = admit(sentence, chunk, input.syntax)

      switch (admitted.kind) {
        case "none":
          continue
        case "some":
          break
      }

      const { lane, sense, effect } = admitted.value
      const at: Anchor = { sentence: si, token: chunk.head }

      events.push({ sentence: si, token: chunk.head, lane, sense, effect })

      switch (lane) {
        case "narrative":
          break
        case "speech":
          continue
        case "offline":
          continue
        case "irrealis":
          continue
        case "negated":
          continue
      }

      switch (embedded.has(chunk.head)) {
        case true:
          addConnectiveEdge(edges, sentence, si, chunk.head, input.syntax)
          continue
        case false:
          break
      }

      switch (effect) {
        case "perfective": {
          switch (retreatArmed && reference.kind === "some") {
            case true:
              edges.push(edge("before", at, (reference as { value: Anchor }).value, "connective"))
              retreatArmed = false
              continue
            case false:
              break
          }

          switch (reference.kind) {
            case "some":
              edges.push(edge("before", reference.value, at, "narrative-advance"))
              break
            case "none":
              break
          }

          for (const stative of pendingStatives.splice(0)) {
            edges.push(edge("during", at, stative, "tense-anaphora"))
          }

          for (const anterior of pendingAnteriors.splice(0)) {
            edges.push(edge("before", anterior, at, "tense-anaphora"))
          }

          reference = { kind: "some", value: at }
          continue
        }
        case "stative": {
          switch (reference.kind) {
            case "some":
              edges.push(edge("during", reference.value, at, "tense-anaphora"))
              continue
            case "none":
              pendingStatives.push(at)
              continue
          }
        }
        case "anterior": {
          switch (reference.kind) {
            case "some":
              edges.push(edge("before", at, reference.value, "tense-anaphora"))
              continue
            case "none":
              pendingAnteriors.push(at)
              continue
          }
        }
        case "posterior": {
          switch (reference.kind) {
            case "some":
              edges.push(edge("before", reference.value, at, "prospection"))
              continue
            case "none":
              continue
          }
        }
        case "none":
          continue
      }
    }
  })

  return { events, edges }
}

function edge(kind: TimelineEdgeKind, from: Anchor, to: Anchor, provenance: TimelineProvenance): TimelineEdge {
  return {
    kind,
    fromSentence: from.sentence,
    fromToken: from.token,
    toSentence: to.sentence,
    toToken: to.token,
    provenance,
  }
}

type Admission = {
  lane: TimelineLane
  sense: string
  effect: TimelineEffect
}

// Whether this VP head is an event, and on which lane. Chained verbs fold:
// a verb whose complement-of matrix is a CONTENT verb is not its own event
// (`veio ver` is one coming); a verb chained onto a PERFECT auxiliary is the
// event carrier with anterior effect (`tinha comido` — the eating, earlier);
// onto a PASSIVE auxiliary it carries the auxiliary's own tense (`foi
// comido` — a perfective eating). The auxiliary itself is never an event
// once something chains onto it.
function admit(sentence: Sentence, vp: Chunk, syntax: SyntaxData): Optional<Admission> {
  const v = vp.head

  switch (auxWithChain(sentence, v, syntax)) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const matrix = chainMatrix(sentence, v)

  let sense = senseOf(sentence, v, syntax)
  let effect: TimelineEffect

  switch (matrix.kind) {
    case "some": {
      const lemma = lemmaAt(sentence, matrix.value)

      switch (syntax.perfectAuxiliaries.includes(lemma)) {
        case true: {
          sense = "pluperfect"
          effect = "anterior"
          break
        }
        case false: {
          switch (syntax.passiveAuxiliaries.includes(lemma)) {
            case true: {
              sense = senseOf(sentence, matrix.value, syntax)
              effect = effectOf(sense)
              break
            }
            case false:
              // Chained onto a content verb: folded into the matrix's event.
              return { kind: "none" }
          }
          break
        }
      }
      break
    }
    case "none":
      effect = effectOf(sense)
      break
  }

  const lane = laneOf(sentence, v, effect)

  switch (lane === "narrative" && effect === "none") {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: { lane, sense, effect } }
  }
}

function laneOf(sentence: Sentence, v: number, effect: TimelineEffect): TimelineLane {
  switch (sentence.attribution.kind) {
    case "speech":
      return "speech"
    case "written":
      return "speech"
    case "narration":
      break
  }

  const negated = sentence.relations.some((r) => r.head === v && r.polarity === "negative")

  switch (negated) {
    case true:
      return "negated"
    case false:
      break
  }

  switch (effect) {
    case "perfective":
      return "narrative"
    case "stative":
      return "narrative"
    case "anterior":
      return "narrative"
    case "posterior":
      return "narrative"
    case "none":
      break
  }

  const sense = senseAt(sentence, v)

  switch (sense === "present") {
    case true:
      return "offline"
    case false:
      return "irrealis"
  }
}

// The DRT narrative convention as a static map over the normalized senses.
function effectOf(sense: string): TimelineEffect {
  switch (sense) {
    case "past":
      return "perfective"
    case "imperfect":
      return "stative"
    case "pluperfect":
      return "anterior"
    case "future":
      return "posterior"
    default:
      return "none"
  }
}

function senseOf(sentence: Sentence, v: number, syntax: SyntaxData): string {
  const tense = verbTense(featAt(sentence, v), syntax.verbFeats)

  switch (tense.kind) {
    case "some":
      return tense.value
    case "none":
      return ""
  }
}

// The sense already computed at admission time is not carried here; this is
// only the offline-vs-irrealis fork for effectless verbs, where the raw feat
// suffices to recognize the present.
function senseAt(sentence: Sentence, v: number): string {
  const feat = featAt(sentence, v)

  switch (feat.startsWith("P") || feat.startsWith("3SG") || feat.startsWith("FIN")) {
    case true:
      return "present"
    case false:
      return ""
  }
}

function auxWithChain(sentence: Sentence, v: number, syntax: SyntaxData): boolean {
  const lemma = lemmaAt(sentence, v)

  const auxiliary =
    syntax.perfectAuxiliaries.includes(lemma) || syntax.passiveAuxiliaries.includes(lemma)

  switch (auxiliary) {
    case false:
      return false
    case true:
      return sentence.relations.some(
        (r) => r.kind === "complement-of" && r.head === v && isVerb(sentence, r.dependent),
      )
  }
}

function chainMatrix(sentence: Sentence, v: number): Optional<number> {
  const chain = sentence.relations.find(
    (r) => r.kind === "complement-of" && r.dependent === v && isVerb(sentence, r.head),
  )

  switch (chain === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: chain!.head }
  }
}

// VP heads inside adverbial subordinate clauses: they order via their
// subordinator's declared edge, never via the narrative chain (`Chorou
// quando o gato sumiu` must not read sumiu as the NEXT event).
function embeddedClauseHeads(sentence: Sentence): ReadonlySet<number> {
  const out = new Set<number>()

  for (const r of sentence.relations) {
    switch (r.kind === "adverbial-of") {
      case false:
        continue
      case true:
        break
    }

    const embedded = sentence.chunks.find((c) => c.kind === "VP" && c.from > r.dependent)

    switch (embedded === undefined) {
      case true:
        continue
      case false:
        out.add(embedded!.head)
        continue
    }
  }

  return out
}

function addConnectiveEdge(
  edges: TimelineEdge[],
  sentence: Sentence,
  si: number,
  sub: number,
  syntax: SyntaxData,
): void {
  const link = sentence.relations.find((r) => {
    switch (r.kind === "adverbial-of") {
      case false:
        return false
      case true:
        break
    }

    const embedded = sentence.chunks.find((c) => c.kind === "VP" && c.from > r.dependent)

    return embedded !== undefined && embedded.head === sub
  })

  switch (link === undefined) {
    case true:
      return
    case false:
      break
  }

  const form = wordAt(sentence, link!.dependent)
  const spec = syntax.subordinatorTime.find((s) => s.form === form)

  switch (spec === undefined) {
    case true:
      return
    case false:
      break
  }

  const subAnchor: Anchor = { sentence: si, token: sub }
  const matrixAnchor: Anchor = { sentence: si, token: link!.head }

  switch (spec!.edge) {
    case "sub-meets-matrix":
      edges.push(edge("meets", subAnchor, matrixAnchor, "connective"))
      return
    case "sub-before-matrix":
      edges.push(edge("before", subAnchor, matrixAnchor, "connective"))
      return
    case "matrix-during-sub":
      edges.push(edge("during", matrixAnchor, subAnchor, "connective"))
      return
    case "matrix-meets-sub":
      edges.push(edge("meets", matrixAnchor, subAnchor, "connective"))
      return
    case "none":
      return
  }
}

function sentenceRetreats(sentence: Sentence, syntax: SyntaxData): boolean {
  for (const token of sentence.tokens) {
    switch (token.role) {
      case "punctuation":
        continue
      case "content": {
        const spec = syntax.timeConnectives.find(
          (c) => c.form === token.tagged.token.text.toLowerCase(),
        )

        return spec !== undefined && spec.role === "retreat"
      }
    }
  }

  return false
}

function featAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.feat
    case "punctuation":
      return ""
  }
}

function lemmaAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.lemma
    case "punctuation":
      return ""
  }
}

function wordAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.token.text.toLowerCase()
    case "punctuation":
      return token.token.text
  }
}

function isVerb(sentence: Sentence, index: number): boolean {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.pos === "VERB"
    case "punctuation":
      return false
  }
}
