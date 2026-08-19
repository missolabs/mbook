// The front end. One paragraph in, its complete intermediate representation
// out, produced by a classic pass pipeline — every pass a total, pure function
// from the previous stage's IR to the next:
//
//   manuscript text ──preprocess──▶ visible text + source map   preprocessor.ts
//   visible text    ──lex─────────▶ tokens                      lexer.ts
//   tokens          ──segment─────▶ sentences (statements)      segmenter.ts
//   sentence        ──tagSentence─▶ classified tokens           tagger.ts
//   classified      ──parsePhrases▶ phrases (NP/VP/PP)          parser.ts
//   phrases         ──bind────────▶ relations (roles)           binder.ts
//   sentences       ──linkDiscourse▶ cross-statement links      dataflow.ts
//
// Each pass's IR is owned by the module that produces it, the way a compiler
// phase owns its output representation. The dictionary is the compiled symbol
// table (lexicon.ts, built by tools/lexicon — the toolchain's other half),
// the language picks the target (language.ts), and the main process is the
// backend: lower.ts flattens this IR to rows, store.ts emits lingua.db — the
// object file. Source fidelity is the invariant the whole ladder preserves:
// every token, span and relation can point back to the exact manuscript
// offsets the author typed, through the preprocessor's source map.

import type { Binding, LineSpan } from "../book/glyphs"
import { parsePhrases } from "./parser"
import type { Chunk } from "./parser"
import { linkDiscourse } from "./dataflow"
import type { DiscourseLink } from "./dataflow"
import type { Language } from "./language"
import { variantScope } from "./language"
import type { Lexicon } from "./lexicon"
import { bind } from "./binder"
import type { Relation, SubjectPin } from "./binder"
import { preprocess, reanchor } from "./preprocessor"
import { segment } from "./segmenter"
import { tagSentence } from "./tagger"
import type { AnalyzedToken } from "./tagger"
import { lex } from "./lexer"
import type { Span, SourceToken } from "./lexer"

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
  const scope = variantScope(input.language)

  // Preprocessing: sigils out, source map kept.
  const source = preprocess(input.text, input.spans)

  // Lexical analysis, re-anchored onto manuscript offsets through the map.
  // The whole-form oracle lets the lexer keep a hyphenated word the symbol
  // table already knows whole (`quinta-feira`) instead of splitting it.
  const keepWhole = (word: string): boolean => {
    switch (input.lexicon.lookup(word, scope).length > 0) {
      case true:
        return true
      case false:
        return input.lexicon.lookup(word.toLowerCase(), scope).length > 0
    }
  }

  const tokens = lex(source.text, input.language, keepWhole).map((token) => reanchor(token, source.map))

  // Statement segmentation: the paragraph's sentences are its compilation
  // statements; each runs the middle passes independently.
  const raw = segment(tokens, input.lexicon.syntax.closedClass.abbreviations)

  const sentences = raw.map((sentence) => analyzeSentence(sentence.tokens, input))

  // Symbol-use anchoring: every authored glyph span is resolved onto the
  // sentence and tokens it covers — the uses table the dataflow pass and the
  // backend both read.
  const spans = input.spans.map((span) => ({ span, anchor: anchorSpan(span, sentences) }))

  // Cross-statement dataflow closes the paragraph.
  const discourse = linkDiscourse({ sentences, spans, syntax: input.lexicon.syntax })

  return {
    text: input.text,
    stripped: source.text,
    language: input.language,
    sentences,
    spans,
    discourse,
  }
}

// The per-statement middle end: classification, shallow parsing, binding and
// voice resolution, in that order — each pass consuming exactly the IR the
// previous one produced.
function analyzeSentence(tokens: readonly SourceToken[], input: ParagraphInput): Sentence {
  const scope = variantScope(input.language)

  const classified = tagSentence({ tokens, lexicon: input.lexicon, scope, syntax: input.lexicon.syntax })

  const source = sentenceSpan(tokens)

  const phrases = parsePhrases(classified, input.lexicon.syntax.chunkRules)

  const base: Sentence = { source, tokens: classified, chunks: phrases, relations: [], attribution: { kind: "narration" } }

  // Authored bindings first (the `@[Name]` pins are declarations), then the
  // binder resolves every remaining role heuristically.
  const pins = subjectPins(base, input.spans)
  const relations = bind({ tokens: classified, chunks: phrases, pins, syntax: input.lexicon.syntax })

  const attribution = deriveAttribution(base, input.spans)

  return { source, tokens: classified, chunks: phrases, relations, attribution }
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
