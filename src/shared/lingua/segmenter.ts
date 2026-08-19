// The segmenter — statement splitting. Sentences are this compiler's
// statements: every middle pass (tagger, parser, binder) runs per sentence,
// and only the dataflow pass sees across them. A boundary falls after a
// terminal mark (. ! ? …), with refinements the naive rule gets wrong:
//   * an abbreviation dot is not terminal — a `.` right after a word in the
//     dictionary's abbreviation list (`Sr`, `Dr`, `etc`) or after a bare
//     initial (`F.` in `F. Scott`) keeps the sentence open;
//   * a closing quote or bracket that trails the terminal belongs to the same
//     sentence, so the cut is placed after it, not before;
//   * a lowercase continuation cancels the cut in the two shapes literary
//     prose leans on: an ellipsis hesitation (`Bem… acho que sim.`) and a
//     dialogue attribution tail after a closing quote (`"Did you see?" she
//     asked.`) or after a travessão (`— Você viu? — perguntou ela.`).
// The caller feeds one paragraph at a time, so the leftover tokens after the
// last terminal are themselves a final sentence — a paragraph is always a
// boundary and this module enforces nothing across paragraphs.

import type { SourceToken } from "./lexer"

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

    const trail = absorbTrailers(tokens, i, buffer)
    i = trail.next

    switch (continuesSentence(tokens, i, token, trail)) {
      case true:
        continue
      case false:
        break
    }

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

type Trailers = {
  next: number
  closingAbsorbed: boolean
  dotsAbsorbed: number
}

// After a terminal, pull any run of further terminals ("?!", "...") and then any
// closing quotes/brackets into the sentence before cutting, recording what was
// absorbed — the continuation rules key on it.
function absorbTrailers(tokens: readonly SourceToken[], from: number, buffer: SourceToken[]): Trailers {
  let i = from
  let closingAbsorbed = false
  let dotsAbsorbed = 0

  while (i < tokens.length) {
    const token = tokens[i]!

    switch (isTerminal(token) || isClosing(token)) {
      case true:
        break
      case false:
        return { next: i, closingAbsorbed, dotsAbsorbed }
    }

    switch (isClosing(token)) {
      case true:
        closingAbsorbed = true
        break
      case false:
        break
    }

    switch (token.text === ".") {
      case true:
        dotsAbsorbed++
        break
      case false:
        break
    }

    buffer.push(token)
    i++
  }

  return { next: i, closingAbsorbed, dotsAbsorbed }
}

// The cut after a terminal is cancelled when what follows reads as the same
// sentence continuing:
//   * a lowercase word after an ellipsis (`…` or a `...` dot run) — hesitation;
//   * a lowercase word after an absorbed closing quote — attribution tail;
//   * a travessão followed by a lowercase word — dialogue attribution.
function continuesSentence(
  tokens: readonly SourceToken[],
  at: number,
  trigger: SourceToken,
  trail: Trailers,
): boolean {
  const next = tokens[at]

  switch (next === undefined) {
    case true:
      return false
    case false:
      break
  }

  const ellipsis = trigger.text === "…" || (trigger.text === "." && trail.dotsAbsorbed >= 2)

  switch ((ellipsis || trail.closingAbsorbed) && isLowercaseWord(next!)) {
    case true:
      return true
    case false:
      break
  }

  switch (isDash(next!) && isLowercaseWord(tokens[at + 1])) {
    case true:
      return true
    case false:
      return false
  }
}

function isLowercaseWord(token: SourceToken | undefined): boolean {
  switch (token === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (token!.kind) {
    case "word":
      break
    case "punctuation":
      return false
    case "number":
      return false
  }

  const first = token!.text[0]!

  return first !== first.toUpperCase()
}

function isDash(token: SourceToken): boolean {
  switch (token.kind) {
    case "punctuation":
      return token.text === "—" || token.text === "–"
    case "word":
      return false
    case "number":
      return false
  }
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
      break
  }

  switch (prev!.kind === "word") {
    case false:
      return false
    case true:
      return abbr.has(prev!.text) || isInitial(prev!.text)
  }
}

// A bare capital letter before a dot is a name initial (`F. Scott`, `J. R.`),
// not a sentence end.
function isInitial(text: string): boolean {
  switch (text.length === 1) {
    case false:
      return false
    case true:
      return text !== text.toLowerCase()
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
