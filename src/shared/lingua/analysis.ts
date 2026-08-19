// The step's composition: one paragraph of source text and its glyph spans in,
// a fully tagged, sentence-segmented analysis out. The flow is a flat pipeline —
// strip the hidden sigil ranges, tokenize the visible text, re-anchor every
// token onto the original source coordinates, segment into sentences, tag each,
// then re-anchor the glyph spans onto the sentences/tokens they cover. The
// output is the exact surface the next step (chunking / relations) extends: a
// Sentence is an open record it will grow `chunks`/`relations` on.

import type { Binding, LineSpan, Range } from "../book/glyphs"
import { chunkSentence } from "./chunk"
import type { Chunk } from "./chunk"
import { buildDiscourseLinks } from "./discourse"
import type { DiscourseLink } from "./discourse"
import type { Language } from "./language"
import { variantScope } from "./language"
import type { Lexicon } from "./lexicon"
import { buildRelations } from "./relations"
import type { Relation, SubjectPin } from "./relations"
import { segment } from "./sentences"
import { tagSentence } from "./tag"
import type { AnalyzedToken } from "./tag"
import { tokenize } from "./tokenize"
import type { Span, SourceToken, Token } from "./tokenize"

export type ParagraphInput = {
  text: string
  spans: readonly LineSpan[]
  lexicon: Lexicon
  language: Language
}

// Who a sentence's words are attributed to. Narration (outside any glyph span)
// has none; a dialogue line is spoken; a run wholly inside a written quote is
// that character's writing.
export type Speaker =
  | { kind: "slug"; slug: string }
  | { kind: "unresolved"; name: string }
  | { kind: "unknown" }

export type Attribution =
  | { kind: "narration" }
  | { kind: "speech"; speaker: Speaker }
  | { kind: "written"; writer: Speaker }

export type Sentence = {
  source: Span
  tokens: readonly AnalyzedToken[]
  chunks: readonly Chunk[]
  relations: readonly Relation[]
  attribution: Attribution
}

export type SpanAnchor =
  | { kind: "in-sentence"; sentence: number; tokens: readonly number[] }
  | { kind: "detached" }

export type AnchoredSpan = {
  span: LineSpan
  anchor: SpanAnchor
}

export type ParagraphAnalysis = {
  text: string
  stripped: string
  language: Language
  sentences: readonly Sentence[]
  spans: readonly AnchoredSpan[]
  discourse: readonly DiscourseLink[]
}

export function analyzeParagraph(input: ParagraphInput): ParagraphAnalysis {
  const hidden = collectHidden(input.spans)
  const stripped = strip(input.text, hidden)

  const tokens = tokenize(stripped.text, input.language)
  const sourceTokens = tokens.map((token) => toSource(token, stripped.map))

  const scope = variantScope(input.language)
  const raw = segment(sourceTokens, input.lexicon.syntax.closedClass.abbreviations)

  const sentences = raw.map((sentence) => {
    const tokens = tagSentence({ tokens: sentence.tokens, lexicon: input.lexicon, scope, syntax: input.lexicon.syntax })
    const source = sentenceSpan(sentence.tokens)
    const chunks = chunkSentence(tokens, input.lexicon.syntax.chunkRules)
    const base: Sentence = { source, tokens, chunks, relations: [], attribution: { kind: "narration" } }

    const pins = subjectPins(base, input.spans)
    const relations = buildRelations({ tokens, chunks, pins, syntax: input.lexicon.syntax })
    const attribution = deriveAttribution(base, input.spans)

    return { source, tokens, chunks, relations, attribution }
  })

  const spans = input.spans.map((span) => ({ span, anchor: anchorSpan(span, sentences) }))

  const discourse = buildDiscourseLinks({ sentences, spans, valency: input.lexicon.syntax.valency })

  return {
    text: input.text,
    stripped: stripped.text,
    language: input.language,
    sentences,
    spans,
    discourse,
  }
}

type Stripped = { text: string; map: readonly number[] }

// Remove every hidden sigil range from the paragraph text, keeping a map from
// each surviving character's stripped index back to its source index — the
// bridge that carries token offsets back onto the text the author typed.
function strip(text: string, hidden: readonly Range[]): Stripped {
  const blocked = new Array(text.length).fill(false)

  for (const range of hidden) {
    blockRange(blocked, range, text.length)
  }

  let result = ""
  const map: number[] = []

  for (let i = 0; i < text.length; i++) {
    switch (blocked[i]) {
      case true:
        continue
      case false:
        result += text[i]
        map.push(i)
        continue
    }
  }

  return { text: result, map }
}

function blockRange(blocked: boolean[], range: Range, length: number): void {
  const end = Math.min(range.to, length)

  for (let i = range.from; i < end; i++) {
    blocked[i] = true
  }
}

function collectHidden(spans: readonly LineSpan[]): readonly Range[] {
  const ranges: Range[] = []

  for (const span of spans) {
    for (const range of span.hidden) {
      ranges.push(range)
    }
  }

  return ranges
}

function toSource(token: Token, map: readonly number[]): SourceToken {
  return {
    kind: token.kind,
    text: token.text,
    stripped: { from: token.from, to: token.to },
    source: { from: map[token.from]!, to: map[token.to - 1]! + 1 },
  }
}

function sentenceSpan(tokens: readonly SourceToken[]): Span {
  const first = tokens[0]!
  const last = tokens[tokens.length - 1]!

  return { from: first.source.from, to: last.source.to }
}

// The resolved subject-mentions covering this sentence, each as the token
// indices it spans — the seam the relation engine pins a subject on. Only
// resolved mentions pin; an unresolved or unknown name is left to the heuristic.
function subjectPins(sentence: Sentence, spans: readonly LineSpan[]): readonly SubjectPin[] {
  const pins: SubjectPin[] = []

  for (const span of spans) {
    const resolved = span.kind === "subject-mention" && span.binding.kind === "resolved"

    switch (resolved) {
      case false:
        continue
      case true:
        break
    }

    const tokens = overlappingTokens(sentence, span)

    switch (tokens.length === 0) {
      case true:
        continue
      case false:
        pins.push({ tokens })
        continue
    }
  }

  return pins
}

// A dialogue line (a speech span overlapping the sentence) is spoken; a sentence
// whose every content token sits inside one written quote is that character's
// writing; anything else is narration. Speech wins over written because a `—`
// line is speech even if it embeds a quote.
function deriveAttribution(sentence: Sentence, spans: readonly LineSpan[]): Attribution {
  const speech = spans.find((span) => span.kind === "speech" && overlaps(sentence.source, span))

  switch (speech === undefined) {
    case false:
      return { kind: "speech", speaker: speakerOf(speech!.binding) }
    case true:
      break
  }

  const written = spans.find((span) => span.kind === "character-written" && enclosesContent(sentence, span))

  switch (written === undefined) {
    case false:
      return { kind: "written", writer: speakerOf(written!.binding) }
    case true:
      return { kind: "narration" }
  }
}

function enclosesContent(sentence: Sentence, span: LineSpan): boolean {
  return sentence.tokens.every((token) => encloses(span, sourceOf(token)))
}

function encloses(span: LineSpan, source: Span): boolean {
  return span.from <= source.from && source.to <= span.to
}

function speakerOf(binding: Binding): Speaker {
  switch (binding.kind) {
    case "resolved":
      return { kind: "slug", slug: binding.slug }
    case "unresolved":
      return { kind: "unresolved", name: binding.name }
    case "unknown":
      return { kind: "unknown" }
  }
}

function anchorSpan(span: LineSpan, sentences: readonly Sentence[]): SpanAnchor {
  for (const [index, sentence] of sentences.entries()) {
    const tokens = overlappingTokens(sentence, span)

    switch (tokens.length === 0) {
      case true:
        continue
      case false:
        return { kind: "in-sentence", sentence: index, tokens }
    }
  }

  return { kind: "detached" }
}

function overlappingTokens(sentence: Sentence, span: LineSpan): readonly number[] {
  const indices: number[] = []

  for (const [index, token] of sentence.tokens.entries()) {
    switch (overlaps(sourceOf(token), span)) {
      case true:
        indices.push(index)
        break
      case false:
        break
    }
  }

  return indices
}

function overlaps(source: Span, span: LineSpan): boolean {
  return source.from < span.to && span.from < source.to
}

function sourceOf(token: AnalyzedToken): Span {
  switch (token.role) {
    case "content":
      return token.tagged.token.source
    case "punctuation":
      return token.token.source
  }
}
