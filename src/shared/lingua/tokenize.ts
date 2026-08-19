// Pure, language-aware tokenizer. Input is one span of already-sigil-stripped
// display text; output is its tokens with half-open [from,to) offsets into that
// same text. A token is a word, a number, or a single punctuation mark; runs of
// whitespace separate tokens and are never emitted.
//
// The one non-trivial job is clitic splitting, and it is language-specific
// because the lexicons dropped the combined forms:
//   * pt-BR drops verb+pronoun clitics (`disse-me`, `dar-te-ei`), so a
//     hyphenated word is split on its hyphens into its parts (`disse`, `me`)
//     and the hyphens are consumed — each part is a form the lexicon can tag.
//   * en drops the clitic pieces themselves — `n't`, `'s`, `'re` are NOT in the
//     dictionary (verified), while the stems (`do`, `is`, `it`) are. So a
//     contraction splits Penn-Treebank style into stem + clitic (`do`+`n't`,
//     `it`+`'s`); the stem hits the lexicon and the clitic is tagged from a
//     closed table in tag.ts. A word whose post-apostrophe tail is not a clitic
//     (`o'clock`, `O'Brien`) is left whole so the lexicon can tag it directly.

import type { Language } from "./language"

export type TokenKind = "word" | "punctuation" | "number"

export type Span = { from: number; to: number }

export type Token = {
  kind: TokenKind
  text: string
  from: number
  to: number
}

// A token re-anchored by the analysis layer: `stripped` is its [from,to) in the
// sigil-stripped text it was tokenized from, `source` its enclosing [from,to) in
// the original paragraph text (the two differ wherever a hidden sigil was cut).
export type SourceToken = {
  kind: TokenKind
  text: string
  stripped: Span
  source: Span
}

export function tokenize(text: string, language: Language): readonly Token[] {
  const tokens: Token[] = []

  let index = 0

  while (index < text.length) {
    const step = scanAt(text, index)

    switch (step.kind) {
      case "skip":
        index = step.next
        continue
      case "word":
        splitWord(text, step.from, step.to, language, tokens)
        index = step.next
        continue
      case "number":
        tokens.push({ kind: "number", text: text.slice(step.from, step.to), from: step.from, to: step.to })
        index = step.next
        continue
      case "punctuation":
        tokens.push({ kind: "punctuation", text: text.slice(step.from, step.to), from: step.from, to: step.to })
        index = step.next
        continue
    }
  }

  return tokens
}

type Scan =
  | { kind: "skip"; next: number }
  | { kind: "word"; from: number; to: number; next: number }
  | { kind: "number"; from: number; to: number; next: number }
  | { kind: "punctuation"; from: number; to: number; next: number }

function scanAt(text: string, index: number): Scan {
  const ch = text[index]!

  switch (isSpace(ch)) {
    case true:
      return { kind: "skip", next: index + 1 }
    case false:
      break
  }

  switch (isLetter(ch)) {
    case true: {
      const end = wordEnd(text, index)
      return { kind: "word", from: index, to: end, next: end }
    }
    case false:
      break
  }

  switch (isDigit(ch)) {
    case true: {
      const end = numberEnd(text, index)
      return { kind: "number", from: index, to: end, next: end }
    }
    case false:
      return { kind: "punctuation", from: index, to: index + 1, next: index + 1 }
  }
}

// A word runs over letters and combining marks, and swallows an apostrophe or
// hyphen only when a letter follows it — so a trailing `-` or `'` is left to be
// its own punctuation mark and the word never ends on a connector.
function wordEnd(text: string, start: number): number {
  let i = start + 1

  while (i < text.length) {
    const ch = text[i]!

    switch (isLetter(ch)) {
      case true:
        i++
        continue
      case false:
        break
    }

    switch (isConnector(ch) && letterFollows(text, i)) {
      case true:
        i++
        continue
      case false:
        return i
    }
  }

  return i
}

function numberEnd(text: string, start: number): number {
  let i = start + 1

  while (i < text.length) {
    const ch = text[i]!

    switch (isDigit(ch)) {
      case true:
        i++
        continue
      case false:
        break
    }

    switch (isNumberSep(ch) && digitFollows(text, i)) {
      case true:
        i++
        continue
      case false:
        return i
    }
  }

  return i
}

function splitWord(
  text: string,
  from: number,
  to: number,
  language: Language,
  out: Token[],
): void {
  switch (language.kind) {
    case "pt-BR":
      splitHyphens(text, from, to, out)
      return
    case "en-US":
      splitContraction(text, from, to, out)
      return
    case "en-UK":
      splitContraction(text, from, to, out)
      return
  }
}

// pt clitics and compounds alike: emit each hyphen-separated run as its own word
// token, dropping the hyphens. Mesoclisis (`dar-te-ei`) falls out for free.
function splitHyphens(text: string, from: number, to: number, out: Token[]): void {
  let runStart = from

  for (let i = from; i < to; i++) {
    switch (text[i] === "-") {
      case true:
        pushWord(text, runStart, i, out)
        runStart = i + 1
        break
      case false:
        break
    }
  }

  pushWord(text, runStart, to, out)
}

function splitContraction(text: string, from: number, to: number, out: Token[]): void {
  const negative = negativeSplit(text, from, to)

  switch (negative.kind) {
    case "split":
      pushWord(text, from, negative.at, out)
      pushWord(text, negative.at, to, out)
      return
    case "none":
      break
  }

  const clitic = cliticSplit(text, from, to)

  switch (clitic.kind) {
    case "split":
      pushWord(text, from, clitic.at, out)
      pushWord(text, clitic.at, to, out)
      return
    case "none":
      pushWord(text, from, to, out)
      return
  }
}

type Split = { kind: "none" } | { kind: "split"; at: number }

// `...n't` / `...n’t`: the clitic is the last three characters, the stem the
// rest, matching the Penn split (`do|n't`, `is|n't`, `wo|n't`, `ca|n't`).
function negativeSplit(text: string, from: number, to: number): Split {
  const len = to - from

  switch (len > 3) {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const tail = normalizeApostrophes(text.slice(to - 3, to)).toLowerCase()

  switch (tail === "n't") {
    case true:
      return { kind: "split", at: to - 3 }
    case false:
      return { kind: "none" }
  }
}

// Any other apostrophe clitic (`'s`, `'re`, `'ve`, `'ll`, `'m`, `'d`): split at
// the apostrophe, but only when the tail is a known clitic — that leaves
// `o'clock` and names like `O'Brien` whole for a direct lexicon hit.
function cliticSplit(text: string, from: number, to: number): Split {
  for (let i = from + 1; i < to - 1; i++) {
    switch (isApostrophe(text[i]!)) {
      case true:
        break
      case false:
        continue
    }

    const tail = normalizeApostrophes(text.slice(i, to)).toLowerCase()

    switch (isCliticTail(tail)) {
      case true:
        return { kind: "split", at: i }
      case false:
        return { kind: "none" }
    }
  }

  return { kind: "none" }
}

function isCliticTail(tail: string): boolean {
  switch (tail) {
    case "'s":
      return true
    case "'re":
      return true
    case "'ve":
      return true
    case "'ll":
      return true
    case "'m":
      return true
    case "'d":
      return true
    default:
      return false
  }
}

function pushWord(text: string, from: number, to: number, out: Token[]): void {
  switch (to > from) {
    case true:
      out.push({ kind: "word", text: text.slice(from, to), from, to })
      return
    case false:
      return
  }
}

function normalizeApostrophes(text: string): string {
  return text.replace(/’/g, "'")
}

function isApostrophe(ch: string): boolean {
  switch (ch) {
    case "'":
      return true
    case "’":
      return true
    default:
      return false
  }
}

function isConnector(ch: string): boolean {
  switch (isApostrophe(ch)) {
    case true:
      return true
    case false:
      return ch === "-"
  }
}

function isNumberSep(ch: string): boolean {
  switch (ch) {
    case ".":
      return true
    case ",":
      return true
    default:
      return false
  }
}

const LETTER = /\p{L}|\p{M}/u

const DIGIT = /\p{Nd}/u

function isLetter(ch: string): boolean {
  return LETTER.test(ch)
}

function isDigit(ch: string): boolean {
  return DIGIT.test(ch)
}

function isSpace(ch: string): boolean {
  return /\s/u.test(ch)
}

function letterFollows(text: string, index: number): boolean {
  const next = text[index + 1]

  switch (next === undefined) {
    case true:
      return false
    case false:
      return isLetter(next!)
  }
}

function digitFollows(text: string, index: number): boolean {
  const next = text[index + 1]

  switch (next === undefined) {
    case true:
      return false
    case false:
      return isDigit(next!)
  }
}
