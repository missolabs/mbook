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

export type TimelineLane = "narrative" | "speech" | "offline" | "irrealis" | "negated" | "reported"

export type TimelineEffect = "perfective" | "stative" | "anterior" | "posterior" | "none"

export type TimelineEvent = {
  sentence: number
  token: number
  lane: TimelineLane
  sense: string
  effect: TimelineEffect
  // Aktionsart, from the declared verb classes ("" when unlisted): a state
  // holds, an achievement is instantaneous — the refinement duration and
  // iteration readings hang off.
  aspect: string
}

// `causes` is the rhetorical edge: a consequence marker (`portanto`, `então`)
// asserts its sentence's events FOLLOW FROM the predecessor's — the one edge
// that carries WHY, not just WHEN. The driver derives it from the discourse
// pass's consequence links.
export type TimelineEdgeKind = "before" | "meets" | "during" | "overlaps" | "causes"

export type TimelineProvenance =
  // An authored `~[...]` time pin ordered these events — the strongest edge.
  | "pinned"
  | "narrative-advance"
  | "tense-anaphora"
  | "connective"
  | "prospection"
  // Sequence-of-tense inside a reported clause: the claim's tense is
  // RELATIVE to the saying (`disse que viria` — the coming after the saying).
  | "reported-tense"

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

// An absolute anchor the calendar rules extracted: a year-shaped numeral, a
// declared month name, or the age idiom (`aos dezessete anos`). It pins the
// sentence's narrative events to fixed time.
export type TimelineAnchor = {
  sentence: number
  token: number
  value: string
}

export type Timeline = {
  events: readonly TimelineEvent[]
  edges: readonly TimelineEdge[]
  anchors: readonly TimelineAnchor[]
  // Authored time pins (`~[1994]`, `~[antes]`) scanned in this paragraph, in
  // order — the driver's stitching reads the first one.
  pins: readonly string[]
}

export type TimelineInput = {
  sentences: readonly Sentence[]
  syntax: SyntaxData
  pins: readonly string[]
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
    const reported = reportedRegions(sentence, input.syntax)
    const prospective = prospectiveEvidence(sentence, input.syntax)
    let retreatArmed = sentenceRetreats(sentence, input.syntax)
    let lastStative: Optional<Anchor> = { kind: "none" }

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

      let { lane, sense, effect } = admitted.value

      // A verb inside a non-factive attitude's complement is REPORTED, not
      // asserted: `disse que Daniela fugiu` is Rei's claim — and so is the
      // conditional `disse que viria`, which would otherwise land on
      // irrealis before this override could see it.
      const reportable = lane === "narrative" || lane === "irrealis" || lane === "offline"

      switch (reportable && reported.some((r) => chunk.head >= r.from && chunk.head < r.to)) {
        case true:
          lane = "reported"
          break
        case false:
          break
      }

      // Prospective narration: a conditional with advance evidence in its
      // sentence is a flash-forward, not irrealis — `anos depois eu
      // entenderia`.
      switch (lane === "irrealis" && sense === "conditional" && prospective) {
        case true:
          lane = "narrative"
          effect = "posterior"
          break
        case false:
          break
      }

      const at: Anchor = { sentence: si, token: chunk.head }

      events.push({ sentence: si, token: chunk.head, lane, sense, effect, aspect: aspectOf(sentence, chunk.head, input.syntax) })

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
        case "reported": {
          // Sequence-of-tense: the claim's tense orders it RELATIVE to the
          // saying — `disse que fugiu` before the saying, `disse que viria`
          // after it, `disse que estava` around it.
          const region = reported.find((r) => chunk.head >= r.from && chunk.head < r.to)

          switch (region === undefined) {
            case true:
              continue
            case false:
              break
          }

          const matrix: Anchor = { sentence: si, token: region!.matrix }

          switch (sense) {
            case "past":
              edges.push(edge("before", at, matrix, "reported-tense"))
              continue
            case "pluperfect":
              edges.push(edge("before", at, matrix, "reported-tense"))
              continue
            case "conditional":
              edges.push(edge("before", matrix, at, "reported-tense"))
              continue
            case "future":
              edges.push(edge("before", matrix, at, "reported-tense"))
              continue
            case "imperfect":
              edges.push(edge("during", matrix, at, "reported-tense"))
              continue
            case "present":
              edges.push(edge("during", matrix, at, "reported-tense"))
              continue
            default:
              continue
          }
        }
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
          // Two background states in one sentence overlap each other:
          // `Chovia e ventava.`
          switch (lastStative.kind) {
            case "some":
              edges.push(edge("overlaps", lastStative.value, at, "tense-anaphora"))
              break
            case "none":
              break
          }

          lastStative = { kind: "some", value: at }

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

  return { events, edges, anchors: calendarAnchors(input), pins: input.pins }
}

function aspectOf(sentence: Sentence, head: number, syntax: SyntaxData): string {
  const hit = syntax.verbClasses.find((v) => v.lemma === lemmaOf(sentence, head))

  switch (hit === undefined) {
    case true:
      return ""
    case false:
      return hit!.class
  }
}

// The calendar rules, all surface-decidable: a year-shaped numeral
// (1000-2999), a declared month name, and the age idiom (`aos NUM anos` /
// `at NUM`). Anchors carry their surface value; joining them to events is
// the consumer's join on the sentence.
function calendarAnchors(input: TimelineInput): readonly TimelineAnchor[] {
  const out: TimelineAnchor[] = []

  input.sentences.forEach((sentence, si) => {
    sentence.tokens.forEach((token, ti) => {
      switch (token.role) {
        case "punctuation":
          return
        case "content":
          break
      }

      const text = token.tagged.token.text

      switch (/^[12]\d{3}$/.test(text)) {
        case true:
          out.push({ sentence: si, token: ti, value: `year:${text}` })
          return
        case false:
          break
      }

      switch (input.syntax.monthNames.includes(text.toLowerCase())) {
        case true:
          out.push({ sentence: si, token: ti, value: `month:${text.toLowerCase()}` })
          return
        case false:
          break
      }

      // The age idiom: a numeral followed by the year-noun (`aos dezessete
      // anos`, `at seventeen`). Spelled-out numerals tag NUM through the
      // dictionary.
      const next = sentence.tokens[ti + 1]

      const age =
        token.tagged.pos === "NUM" &&
        next !== undefined &&
        next.role === "content" &&
        next.tagged.lemma === "ano"

      switch (age) {
        case true:
          out.push({ sentence: si, token: ti, value: `age:${text}` })
          return
        case false:
          return
      }
    })
  })

  return out
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

type Region = { from: number; to: number; matrix: number }

// The reported spans of a sentence: each complement-of whose matrix is a
// verb of saying or a NON-factive attitude verb scopes its clause — forward
// to the sentence end for `disse QUE...`, backward to the attribution
// boundary for the inverted quote (`"...," disse Rei`). Factives assert
// their complements and mint no region.
function reportedRegions(sentence: Sentence, syntax: SyntaxData): readonly Region[] {
  const out: Region[] = []

  for (const r of sentence.relations) {
    switch (r.kind === "complement-of") {
      case false:
        continue
      case true:
        break
    }

    const matrix = lemmaOf(sentence, r.head)

    const reporting =
      (syntax.dicendi.includes(matrix) || syntax.reportingVerbs.includes(matrix)) &&
      syntax.factiveVerbs.includes(matrix) === false

    switch (reporting) {
      case false:
        continue
      case true:
        break
    }

    switch (r.dependent < r.head) {
      case true:
        out.push({ from: r.dependent, to: r.head, matrix: r.head })
        continue
      case false:
        out.push({ from: r.dependent, to: sentence.tokens.length, matrix: r.head })
        continue
    }
  }

  return out
}

function lemmaOf(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.lemma
    case "punctuation":
      return ""
  }
}

// Advance evidence licensing prospective narration: a declared advance
// connective anywhere in the sentence, or a temporal adjunct relation.
function prospectiveEvidence(sentence: Sentence, syntax: SyntaxData): boolean {
  switch (sentence.relations.some((r) => r.kind === "temporal-of")) {
    case true:
      return true
    case false:
      break
  }

  for (const token of sentence.tokens) {
    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        break
    }

    const spec = syntax.timeConnectives.find((c) => c.form === token.tagged.token.text.toLowerCase())

    switch (spec !== undefined && spec!.role === "advance") {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
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
