// The preprocessor. Glyph sigils are directives, not prose: `@[`, `]`, `{…}`
// carry binding information the later passes read from span metadata, never
// from the text itself. This pass removes every hidden sigil range and keeps a
// SOURCE MAP — for each surviving character, its offset in the text the author
// typed — so that every downstream token, span and diagnostic can point back
// at real manuscript coordinates. The same discipline as any compiler that
// expands away surface syntax: nothing later ever re-parses a sigil, and
// nothing later loses the original location.

import type { LineSpan, Range } from "../book/glyphs"
import type { SourceToken, Token } from "./lexer"

// The preprocessed source: the visible text the lexer will scan, plus the map
// from each of its character offsets back to the author's original offsets.
export type PreprocessedSource = { text: string; map: readonly number[] }

export function preprocess(text: string, spans: readonly LineSpan[]): PreprocessedSource {
  const blocked = new Array(text.length).fill(false)

  for (const range of collectHidden(spans)) {
    blockRange(blocked, range, text.length)
  }

  for (const range of markupRanges(text)) {
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

// Re-anchor a lexed token through the source map: `stripped` keeps its offsets
// in the preprocessed text, `source` carries them back onto the manuscript.
export function reanchor(token: Token, map: readonly number[]): SourceToken {
  return {
    kind: token.kind,
    text: token.text,
    stripped: { from: token.from, to: token.to },
    source: { from: map[token.from]!, to: map[token.to - 1]! + 1 },
  }
}

// The book's own formatting marks are surface syntax too: the centred-line
// arrows (`-> text <-`), the extract marker (`> `), and emphasis asterisks
// carry typesetting, not prose — left in the stream they lex as junk
// punctuation and poison the sentence. Hidden the same way sigils are, per
// line of the paragraph.
function markupRanges(text: string): readonly Range[] {
  const ranges: Range[] = []
  let lineStart = 0

  for (const line of text.split("\n")) {
    const centeredOpen = line.match(/^->\s?/)

    switch (centeredOpen === null) {
      case false:
        ranges.push({ from: lineStart, to: lineStart + centeredOpen![0].length })
        break
      case true:
        break
    }

    const centeredClose = line.match(/\s?<-$/)

    switch (centeredClose === null) {
      case false:
        ranges.push({ from: lineStart + line.length - centeredClose![0].length, to: lineStart + line.length })
        break
      case true:
        break
    }

    const extract = line.match(/^>\s?/)

    switch (extract === null) {
      case false:
        ranges.push({ from: lineStart, to: lineStart + extract![0].length })
        break
      case true:
        break
    }

    for (const emphasis of line.matchAll(/\*{1,2}/g)) {
      ranges.push({ from: lineStart + emphasis.index!, to: lineStart + emphasis.index! + emphasis[0].length })
    }

    lineStart += line.length + 1
  }

  return ranges
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

function blockRange(blocked: boolean[], range: Range, length: number): void {
  const end = Math.min(range.to, length)

  for (let i = range.from; i < end; i++) {
    blocked[i] = true
  }
}
