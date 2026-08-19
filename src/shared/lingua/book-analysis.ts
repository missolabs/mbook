// Book-level composition: the whole book's source text in, a complete linguistic
// analysis out. This is the pure pipeline that stitches the book domain
// (parse -> cast -> glyphs -> language) to the paragraph analyzer, running the
// analyzer once per paragraph block and collecting every result. It is the seam
// the main-process store persists and the one place paragraph coordinates are
// derived, so it stays pure and is unit-tested against the real dictionaries.
//
// Coordinates: scanGlyphs lifts each line's spans to doc-absolute offsets by
// advancing one character per joining newline. A paragraph's text is therefore
// its lines joined by "\n", and a doc-absolute span is re-based onto that text by
// subtracting the paragraph's start offset — the two coordinate systems line up
// exactly because both count the newline as one character.

import { buildCast } from "../book/cast"
import type { Cast } from "../book/cast"
import type { Binding, GlyphSpan, LineSpan } from "../book/glyphs"
import { scanGlyphs } from "../book/glyphs"
import { chapterAtLine, chapterList } from "../book/outline"
import type { Chapter } from "../book/outline"
import { parseBookDoc } from "../book/parse"
import type { Block } from "../book/parse"
import type { Optional } from "../optional"
import { err, ok } from "../result"
import type { Result } from "../result"
import { analyzeParagraph } from "./analysis"
import type { ParagraphAnalysis } from "./analysis"
import { readLanguage } from "./language"
import type { Language } from "./language"
import type { Lexicon } from "./lexicon"

// Where a sentence sits in the book: its enclosing chapter (1-based
// auto-number plus title, none before the first `##` heading) and the 1-based
// doc line and column of the sentence's first character.
export type ChapterPlace = { index: number; title: string }

export type SentenceLocation = {
  chapter: Optional<ChapterPlace>
  line: number
  col: number
}

// `locations` is index-aligned with `analysis.sentences`: sentence i of this
// paragraph was found at locations[i].
export type ParagraphSlot = {
  index: number
  fromLine: number
  toLine: number
  analysis: ParagraphAnalysis
  locations: readonly SentenceLocation[]
}

export type BookAnalysis = {
  language: Language
  cast: Cast
  paragraphs: readonly ParagraphSlot[]
  spans: readonly GlyphSpan[]
  unresolved: readonly string[]
}

export type BookAnalysisError = { kind: "lexicon-unavailable"; language: Language }

// The engine's injected view of the loaded lexicons: a book's language selects
// its dictionary, or none when that dictionary failed to load.
export type LexiconSource = (language: Language) => Optional<Lexicon>

export function analyzeBook(
  content: string,
  source: LexiconSource,
): Result<BookAnalysis, BookAnalysisError> {
  const lines = content.split("\n")
  const doc = parseBookDoc(lines)
  const language = readLanguage(doc)

  const lexicon = source(language)

  switch (lexicon.kind) {
    case "none":
      return err({ kind: "lexicon-unavailable", language })
    case "some":
      break
  }

  const cast = buildCast(doc)
  const spans = scanGlyphs(lines, cast)
  const starts = lineStarts(lines)
  const chapters = chapterList(doc)

  const paragraphs = paragraphBlocks(doc.blocks).map((block, index) =>
    analyzeSlot(block, index, lines, spans, starts, chapters, lexicon.value, language),
  )

  return ok({
    language,
    cast,
    paragraphs,
    spans,
    unresolved: unresolvedNames(spans),
  })
}

type ParagraphBlock = { fromLine: number; toLine: number }

function paragraphBlocks(blocks: readonly Block[]): readonly ParagraphBlock[] {
  const out: ParagraphBlock[] = []

  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
        out.push({ fromLine: block.fromLine, toLine: block.toLine })
        continue
      default:
        continue
    }
  }

  return out
}

function analyzeSlot(
  block: ParagraphBlock,
  index: number,
  lines: readonly string[],
  spans: readonly GlyphSpan[],
  starts: readonly number[],
  chapters: readonly Chapter[],
  lexicon: Lexicon,
  language: Language,
): ParagraphSlot {
  const base = starts[block.fromLine]!
  const text = lines.slice(block.fromLine, block.toLine + 1).join("\n")
  const local = spansInBlock(spans, block, base)

  const analysis = analyzeParagraph({ text, spans: local, lexicon, language })

  const locations = analysis.sentences.map((sentence) =>
    locate(base + sentence.source.from, block, starts, chapters),
  )

  return { index, fromLine: block.fromLine, toLine: block.toLine, analysis, locations }
}

// Doc-absolute offset of a sentence's first character -> its 1-based line and
// column plus enclosing chapter. The line is found inside the sentence's own
// paragraph block, whose line starts bracket every offset the analyzer yields.
function locate(
  offset: number,
  block: ParagraphBlock,
  starts: readonly number[],
  chapters: readonly Chapter[],
): SentenceLocation {
  let lineIdx = block.fromLine

  for (let li = block.fromLine; li <= block.toLine; li++) {
    switch (starts[li]! <= offset) {
      case true:
        lineIdx = li
        continue
      case false:
        continue
    }
  }

  return {
    chapter: placeOf(chapterAtLine(chapters, lineIdx), chapters),
    line: lineIdx + 1,
    col: offset - starts[lineIdx]! + 1,
  }
}

function placeOf(found: Optional<number>, chapters: readonly Chapter[]): Optional<ChapterPlace> {
  switch (found.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      return { kind: "some", value: { index: found.value + 1, title: chapters[found.value]!.title } }
  }
}

function spansInBlock(
  spans: readonly GlyphSpan[],
  block: ParagraphBlock,
  base: number,
): readonly LineSpan[] {
  const out: LineSpan[] = []

  for (const span of spans) {
    switch (span.line >= block.fromLine && span.line <= block.toLine) {
      case true:
        out.push(rebase(span, base))
        continue
      case false:
        continue
    }
  }

  return out
}

// Doc-absolute glyph span -> paragraph-relative LineSpan: every offset drops the
// paragraph's start, and the `line` tag is discarded (the analyzer works in one
// paragraph's coordinates and never needs it).
function rebase(span: GlyphSpan, base: number): LineSpan {
  return {
    kind: span.kind,
    from: span.from - base,
    to: span.to - base,
    hidden: span.hidden.map((range) => ({ from: range.from - base, to: range.to - base })),
    text: span.text,
    binding: span.binding,
  }
}

// Doc-absolute start offset of every line: line i begins after all earlier lines
// and their joining newlines, the same arithmetic scanGlyphs lifts spans with.
function lineStarts(lines: readonly string[]): readonly number[] {
  const starts: number[] = []
  let offset = 0

  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  return starts
}

// Every distinct name an author mentioned that binds to no declared character,
// in first-seen order — the unresolved references the store records alongside the
// resolved cast.
function unresolvedNames(spans: readonly GlyphSpan[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const span of spans) {
    const name = unresolvedOf(span.binding)

    switch (name.kind) {
      case "none":
        continue
      case "some":
        break
    }

    switch (seen.has(name.value)) {
      case true:
        continue
      case false:
        seen.add(name.value)
        out.push(name.value)
        continue
    }
  }

  return out
}

function unresolvedOf(binding: Binding): Optional<string> {
  switch (binding.kind) {
    case "unresolved":
      return { kind: "some", value: binding.name }
    case "resolved":
      return { kind: "none" }
    case "unknown":
      return { kind: "none" }
  }
}
