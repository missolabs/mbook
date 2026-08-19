// Sentence segmentation over a token stream. A boundary falls after a terminal
// mark (. ! ? …), with two refinements the naive rule gets wrong:
//   * an abbreviation dot is not terminal — a `.` right after a word in the
//     dictionary's abbreviation list (`Sr`, `Dr`, `etc`) keeps the sentence open;
//   * a closing quote or bracket that trails the terminal belongs to the same
//     sentence, so the cut is placed after it, not before.
// The caller feeds one paragraph at a time, so the leftover tokens after the
// last terminal are themselves a final sentence — a paragraph is always a
// boundary and this module enforces nothing across paragraphs.

import type { SourceToken } from "./tokenize"

export type RawSentence = { tokens: readonly SourceToken[] }

export function segment(
  tokens: readonly SourceToken[],
  abbreviations: readonly string[],
): readonly RawSentence[] {
  const abbr = new Set(abbreviations)

  const sentences: RawSentence[] = []
  let buffer: SourceToken[] = []

  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]!
    buffer.push(token)
    i++

    switch (isTerminal(token) && !closesAbbreviation(token, buffer, abbr)) {
      case false:
        continue
      case true:
        break
    }

    i = absorbTrailers(tokens, i, buffer)

    sentences.push({ tokens: buffer })
    buffer = []
  }

  switch (buffer.length === 0) {
    case true:
      return sentences
    case false:
      return [...sentences, { tokens: buffer }]
  }
}

// After a terminal, pull any run of further terminals ("?!", "...") and then any
// closing quotes/brackets into the sentence before cutting.
function absorbTrailers(tokens: readonly SourceToken[], from: number, buffer: SourceToken[]): number {
  let i = from

  while (i < tokens.length) {
    const token = tokens[i]!

    switch (isTerminal(token) || isClosing(token)) {
      case true:
        buffer.push(token)
        i++
        continue
      case false:
        return i
    }
  }

  return i
}

function closesAbbreviation(token: SourceToken, buffer: SourceToken[], abbr: Set<string>): boolean {
  switch (token.text === ".") {
    case false:
      return false
    case true:
      break
  }

  const prev = buffer[buffer.length - 2]

  switch (prev === undefined) {
    case true:
      return false
    case false:
      return prev!.kind === "word" && abbr.has(prev!.text)
  }
}

function isTerminal(token: SourceToken): boolean {
  switch (token.kind) {
    case "punctuation":
      return isTerminalMark(token.text)
    case "word":
      return false
    case "number":
      return false
  }
}

function isTerminalMark(text: string): boolean {
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

function isClosing(token: SourceToken): boolean {
  switch (token.kind) {
    case "punctuation":
      return isClosingMark(token.text)
    case "word":
      return false
    case "number":
      return false
  }
}

function isClosingMark(text: string): boolean {
  switch (text) {
    case "\"":
      return true
    case "”":
      return true
    case "’":
      return true
    case "»":
      return true
    case ")":
      return true
    case "]":
      return true
    default:
      return false
  }
}
