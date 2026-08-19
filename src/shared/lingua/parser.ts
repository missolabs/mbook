// The parser — a shallow phrase parser. The grammar is DATA: the dictionary
// ships hand-authored EBNF-ish productions over POS categories
// (SyntaxData.chunkRules — each pattern item a terminal with a `one`/`opt`/
// `star` quantifier), and this module is only their matcher: a greedy
// longest-match with backtracking quantifiers, run left-to-right over one
// sentence's classified tokens, yielding non-overlapping NP/VP/PP phrases —
// the parse IR the binder consumes. Each phrase carries its half-open token
// range and the index of its head token.
//
// Token indices are positions in the sentence's own `tokens` array (the same
// array glyph anchors and relations index into), so a chunk, a mention's covered
// tokens, and a dependency all speak one coordinate system.
//
// Punctuation is a hard break: a chunk never spans a comma or a dash, so the
// matcher runs inside maximal runs of adjacent content tokens ("segments") and
// the rules only ever see word/number POS tags.
//
// Head selection is per kind and language-principled, not "rightmost token":
//   * NP — the rightmost NOUN or PROPN; this is what makes a head-initial
//     Portuguese `casa grande` (NOUN ADJ) head on `casa`, not the trailing ADJ.
//     A pronoun-only NP has no noun, so its single PRON is the head.
//   * VP — the main verb: the last VERB in the group, so a `tinha comido`
//     (AUX VERB) heads on the participle and auxiliaries are passed over.
//   * PP — the NP head inside it (the rightmost NOUN/PROPN, or the PRON of an
//     `ADP PRON` pair); the preposition attaches to that head rather than being
//     it.

import type { AnalyzedToken } from "./tagger"
import type { ChunkKind, ChunkRule, PatItem, Pos } from "./model"
import type { Optional } from "../optional"

export type Chunk = {
  kind: ChunkKind
  from: number
  to: number
  head: number
}

type Slot = { index: number; pos: Pos }

export function parsePhrases(
  tokens: readonly AnalyzedToken[],
  rules: readonly ChunkRule[],
): readonly Chunk[] {
  const segments = contentSegments(tokens)

  const chunks: Chunk[] = []

  for (const segment of segments) {
    chunkSegment(segment, rules, chunks)
  }

  return chunks
}

// Maximal runs of adjacent content tokens; a punctuation token ends the current
// run so no chunk can straddle it.
function contentSegments(tokens: readonly AnalyzedToken[]): readonly (readonly Slot[])[] {
  const segments: Slot[][] = []
  let current: Slot[] = []

  tokens.forEach((token, index) => {
    switch (token.role) {
      case "content":
        current.push({ index, pos: token.tagged.pos })
        return
      case "punctuation":
        flush(segments, current)
        current = []
        return
    }
  })

  flush(segments, current)

  return segments
}

function flush(segments: Slot[][], current: Slot[]): void {
  switch (current.length === 0) {
    case true:
      return
    case false:
      segments.push(current)
      return
  }
}

function chunkSegment(segment: readonly Slot[], rules: readonly ChunkRule[], out: Chunk[]): void {
  let i = 0

  while (i < segment.length) {
    const match = longestMatch(segment, i, rules)

    switch (match.kind) {
      case "some":
        out.push(makeChunk(match.value.kind, segment, i, match.value.end))
        i = match.value.end
        continue
      case "none":
        i++
        continue
    }
  }
}

type Match = { kind: ChunkKind; end: number }

// Try every rule at this position; keep the one reaching the furthest token.
// Ties go to the earlier rule in the list, which is the authored precedence.
function longestMatch(segment: readonly Slot[], start: number, rules: readonly ChunkRule[]): Optional<Match> {
  let best: Optional<Match> = { kind: "none" }
  let bestEnd = start

  for (const rule of rules) {
    const end = matchRule(rule.pattern, 0, segment, start)

    switch (end.kind) {
      case "none":
        continue
      case "some":
        break
    }

    switch (end.value > bestEnd) {
      case true:
        best = { kind: "some", value: { kind: rule.chunk, end: end.value } }
        bestEnd = end.value
        continue
      case false:
        continue
    }
  }

  return best
}

// The furthest token index the remaining pattern can reach from `ti`, or none if
// a mandatory item cannot be satisfied. `opt`/`star` branch and we keep the
// longest successful parse, so a trailing greedy item never starves a later
// mandatory one.
function matchRule(pattern: readonly PatItem[], pi: number, segment: readonly Slot[], ti: number): Optional<number> {
  switch (pi === pattern.length) {
    case true:
      return { kind: "some", value: ti }
    case false:
      break
  }

  const item = pattern[pi]!

  switch (item.quant) {
    case "one":
      return matchOne(pattern, pi, segment, ti, item.pos)
    case "opt":
      return matchOpt(pattern, pi, segment, ti, item.pos)
    case "star":
      return matchStar(pattern, pi, segment, ti, item.pos)
  }
}

function matchOne(pattern: readonly PatItem[], pi: number, segment: readonly Slot[], ti: number, pos: Pos): Optional<number> {
  switch (posAt(segment, ti) === pos) {
    case true:
      return matchRule(pattern, pi + 1, segment, ti + 1)
    case false:
      return { kind: "none" }
  }
}

function matchOpt(pattern: readonly PatItem[], pi: number, segment: readonly Slot[], ti: number, pos: Pos): Optional<number> {
  const skipped = matchRule(pattern, pi + 1, segment, ti)

  switch (posAt(segment, ti) === pos) {
    case true:
      return longer(skipped, matchRule(pattern, pi + 1, segment, ti + 1))
    case false:
      return skipped
  }
}

function matchStar(pattern: readonly PatItem[], pi: number, segment: readonly Slot[], ti: number, pos: Pos): Optional<number> {
  const skipped = matchRule(pattern, pi + 1, segment, ti)

  switch (posAt(segment, ti) === pos) {
    case true:
      return longer(skipped, matchStar(pattern, pi, segment, ti + 1, pos))
    case false:
      return skipped
  }
}

function longer(a: Optional<number>, b: Optional<number>): Optional<number> {
  switch (a.kind) {
    case "none":
      return b
    case "some":
      break
  }

  switch (b.kind) {
    case "none":
      return a
    case "some":
      break
  }

  switch (b.value > a.value) {
    case true:
      return b
    case false:
      return a
  }
}

// Out-of-range reads a sentinel that matches no real POS, so a pattern item can
// never match past the segment's end.
function posAt(segment: readonly Slot[], ti: number): Pos | "-" {
  const slot = segment[ti]

  switch (slot === undefined) {
    case true:
      return "-"
    case false:
      return slot!.pos
  }
}

function makeChunk(kind: ChunkKind, segment: readonly Slot[], start: number, end: number): Chunk {
  const from = segment[start]!.index
  const to = segment[end - 1]!.index + 1
  const head = headIndex(kind, segment, start, end)

  return { kind, from, to, head }
}

function headIndex(kind: ChunkKind, segment: readonly Slot[], start: number, end: number): number {
  switch (kind) {
    case "NP":
      return nominalHead(segment, start, end)
    case "PP":
      return nominalHead(segment, start, end)
    case "VP":
      return verbalHead(segment, start, end)
  }
}

// Rightmost NOUN/PROPN; falls back to the last token (a pronoun NP/PP).
function nominalHead(segment: readonly Slot[], start: number, end: number): number {
  let head = segment[end - 1]!.index

  for (let k = start; k < end; k++) {
    switch (isNominal(segment[k]!.pos)) {
      case true:
        head = segment[k]!.index
        continue
      case false:
        continue
    }
  }

  return head
}

// Last VERB; falls back to the last token, though a VP rule always has a VERB.
function verbalHead(segment: readonly Slot[], start: number, end: number): number {
  let head = segment[end - 1]!.index

  for (let k = start; k < end; k++) {
    switch (segment[k]!.pos === "VERB") {
      case true:
        head = segment[k]!.index
        continue
      case false:
        continue
    }
  }

  return head
}

function isNominal(pos: Pos): boolean {
  switch (pos) {
    case "NOUN":
      return true
    case "PROPN":
      return true
    default:
      return false
  }
}
