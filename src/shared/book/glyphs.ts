// Glyph scanning: the hidden character syntax an author writes and the editor
// renders. A glyph span pairs the visible text with the raw sigil characters a
// renderer must conceal, plus the character it binds to. Pure, line-by-line —
// spans never cross a line boundary, so a CodeMirror ViewPlugin can scan one
// visible line at a time (scanLine) while the whole-book projection (scanGlyphs)
// lifts those line-relative offsets to doc-absolute positions.
//
// The five constructs (v4 syntax):
//   @[Name]            visible mention   — display is the name; `@[` and `]` hide
//   {display}[Name]    display group     — display is the group; `{`,`}`,`[Name]` hide
//   —[Name] ...        bound dialogue    — speech; `[Name]` hides, the space
//                      stays so the page keeps the conventional `— Olá.`
//   —...               bare dialogue     — speech, speaker unknown; nothing hides
//   “[Name] ...”       written quote     — the run is character-written; `[Name] ` hides
//   ~[value]           time pin          — an authored temporal anchor (`~[1994]`,
//                      `~[+3 anos]`, `~[antes]`); the WHOLE glyph hides — time
//                      metadata is not typeset. Its payload rides `text`.
// A bare `[qualquer coisa]` in prose is ordinary text: the `[Name]` binding is
// recognized ONLY in the anchored positions above, never on its own.
//
// Any binding position accepts SEVERAL names, comma-separated —
// `{elas}[Esposa, Filha]`, `—[Rei, Daniela]` — producing a group binding.

import type { Cast, Resolution } from "./cast"
import { resolve } from "./cast"

export type GlyphKind = "subject-mention" | "speech" | "character-written" | "time-anchor"

export type Range = { from: number; to: number }

// A binding names one character — or, comma-separated, SEVERAL at once:
// `{elas}[Esposa, Filha]` binds the plural display to both members. A group
// keeps its unresolved names alongside its resolved slugs so each missing
// declaration can be flagged on its own.
export type Binding =
  | Resolution
  | { kind: "unknown" }
  | { kind: "group"; slugs: readonly string[]; unresolved: readonly string[] }

// The payload between the brackets, resolved: a comma splits it into a group
// (empty segments dropped, so a trailing comma is forgiven); anything without
// a comma stays the single resolution it always was.
function resolveBinding(cast: Cast, payload: string): Binding {
  switch (payload.includes(",")) {
    case false:
      return resolve(cast, payload)
    case true:
      break
  }

  const names = payload
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  switch (names.length < 2) {
    case true:
      return resolve(cast, names[0] ?? payload)
    case false:
      break
  }

  const slugs: string[] = []
  const unresolved: string[] = []

  for (const name of names) {
    const resolution = resolve(cast, name)

    switch (resolution.kind) {
      case "resolved":
        slugs.push(resolution.slug)
        continue
      case "unresolved":
        unresolved.push(name)
        continue
    }
  }

  return { kind: "group", slugs, unresolved }
}

// Offsets are relative to the start of the scanned line.
export type LineSpan = {
  kind: GlyphKind
  from: number
  to: number
  hidden: readonly Range[]
  text: string
  binding: Binding
}

// The same span lifted onto the whole document: offsets are doc-absolute and
// `line` records which line it was scanned from.
export type GlyphSpan = {
  kind: GlyphKind
  line: number
  from: number
  to: number
  hidden: readonly Range[]
  text: string
  binding: Binding
}

type Bracket =
  | { kind: "none" }
  | { kind: "some"; name: string; close: number }

type Step =
  | { kind: "advance"; next: number }
  | { kind: "emit"; span: LineSpan; next: number }

type SpeechScan =
  | { kind: "none" }
  | { kind: "some"; span: LineSpan }

type SpeechBinding = { hidden: readonly Range[]; binding: Binding }

// One line's worth of spans, offsets relative to the line. This is the seam a
// CodeMirror ViewPlugin drives, feeding it `view.state.doc.lineAt(pos).text`.
export function scanLine(text: string, cast: Cast): readonly LineSpan[] {
  const speech = leadSpeech(text, cast)
  const inline = scanInline(text, cast)

  switch (speech.kind) {
    case "none":
      return inline
    case "some":
      return [speech.span, ...inline]
  }
}

// The whole book: every line scanned, offsets lifted to doc-absolute. A line's
// start advances by its length plus one for the joining newline — the same
// anchoring CodeMirror's `doc.lineAt(pos).from` uses, so ranges line up exactly.
export function scanGlyphs(lines: readonly string[], cast: Cast): readonly GlyphSpan[] {
  const spans: GlyphSpan[] = []
  let offset = 0

  for (const [line, text] of lines.entries()) {
    for (const span of scanLine(text, cast)) {
      spans.push(liftSpan(span, line, offset))
    }

    offset += text.length + 1
  }

  return spans
}

function liftSpan(span: LineSpan, line: number, offset: number): GlyphSpan {
  return {
    kind: span.kind,
    line,
    from: span.from + offset,
    to: span.to + offset,
    hidden: span.hidden.map((range) => ({ from: range.from + offset, to: range.to + offset })),
    text: span.text,
    binding: span.binding,
  }
}

// A paragraph line opening with `—` is dialogue — always speech, whether or not
// a `[Name]` binds the speaker.
function leadSpeech(text: string, cast: Cast): SpeechScan {
  switch (text.startsWith("—")) {
    case false:
      return { kind: "none" }
    case true:
      return { kind: "some", span: speechSpan(text, cast) }
  }
}

function speechSpan(text: string, cast: Cast): LineSpan {
  const bound = speechBinding(text, cast)

  return {
    kind: "speech",
    from: 0,
    to: text.length,
    hidden: bound.hidden,
    text: stripHidden(text, 0, text.length, bound.hidden),
    binding: bound.binding,
  }
}

function speechBinding(text: string, cast: Cast): SpeechBinding {
  switch (text[1] === "[") {
    case false:
      return { hidden: [], binding: { kind: "unknown" } }
    case true:
      break
  }

  const bracket = readBracket(text, 1)

  switch (bracket.kind) {
    case "none":
      return { hidden: [], binding: { kind: "unknown" } }
    case "some":
      return { hidden: [{ from: 1, to: bracket.close + 1 }], binding: resolveBinding(cast, bracket.name) }
  }
}

// The inline constructs (`@[..]`, `{..}[..]`, `“[..]..”`) may sit anywhere in a
// line, so this is a single left-to-right walk that hands each position to a
// classifier and jumps past whatever it consumes.
function scanInline(text: string, cast: Cast): readonly LineSpan[] {
  const spans: LineSpan[] = []
  let index = 0

  while (index < text.length) {
    const step = classifyAt(text, index, cast)

    switch (step.kind) {
      case "advance":
        index = step.next
        continue
      case "emit":
        spans.push(step.span)
        index = step.next
        continue
    }
  }

  return spans
}

function classifyAt(text: string, index: number, cast: Cast): Step {
  switch (text[index]) {
    case "@":
      return atMention(text, index, cast)
    case "{":
      return atDisplayGroup(text, index, cast)
    case "“":
      return atQuote(text, index, "”", cast)
    case "\"":
      return atQuote(text, index, "\"", cast)
    case "~":
      return atTimeAnchor(text, index)
    default:
      return { kind: "advance", next: index + 1 }
  }
}

// `~[value]` — the authored time pin. Everything hides, one trailing space
// included; the payload travels in `text` (a time pin has no display and no
// character binding).
function atTimeAnchor(text: string, index: number): Step {
  switch (text[index + 1] === "[") {
    case false:
      return { kind: "advance", next: index + 1 }
    case true:
      break
  }

  const bracket = readBracket(text, index + 1)

  switch (bracket.kind) {
    case "none":
      return { kind: "advance", next: index + 1 }
    case "some": {
      const to = extendSpace(text, bracket.close + 1)

      const span: LineSpan = {
        kind: "time-anchor",
        from: index,
        to,
        hidden: [{ from: index, to }],
        text: bracket.name,
        binding: { kind: "unknown" },
      }

      return { kind: "emit", span, next: to }
    }
  }
}

// `@[Name]` — the name itself is the display; `@[` and the closing `]` hide.
function atMention(text: string, index: number, cast: Cast): Step {
  switch (text[index + 1] === "[") {
    case false:
      return { kind: "advance", next: index + 1 }
    case true:
      break
  }

  const bracket = readBracket(text, index + 1)

  switch (bracket.kind) {
    case "none":
      return { kind: "advance", next: index + 1 }
    case "some":
      return mentionSpan(text, index, bracket.name, bracket.close, cast)
  }
}

function mentionSpan(text: string, index: number, name: string, close: number, cast: Cast): Step {
  const to = close + 1
  const hidden: readonly Range[] = [{ from: index, to: index + 2 }, { from: close, to }]

  const span: LineSpan = {
    kind: "subject-mention",
    from: index,
    to,
    hidden,
    text: stripHidden(text, index, to, hidden),
    binding: resolveBinding(cast, name),
  }

  return { kind: "emit", span, next: to }
}

// `{display}[Name]` — the braced text is the display; `{`, `}` and the whole
// `[Name]` group hide.
function atDisplayGroup(text: string, index: number, cast: Cast): Step {
  const brace = text.indexOf("}", index + 1)

  switch (brace < 0) {
    case true:
      return { kind: "advance", next: index + 1 }
    case false:
      break
  }

  switch (text[brace + 1] === "[") {
    case false:
      return { kind: "advance", next: index + 1 }
    case true:
      break
  }

  const bracket = readBracket(text, brace + 1)

  switch (bracket.kind) {
    case "none":
      return { kind: "advance", next: index + 1 }
    case "some":
      return displaySpan(text, index, brace, bracket.name, bracket.close, cast)
  }
}

function displaySpan(text: string, index: number, brace: number, name: string, close: number, cast: Cast): Step {
  const to = close + 1
  const hidden: readonly Range[] = [
    { from: index, to: index + 1 },
    { from: brace, to: brace + 1 },
    { from: brace + 1, to },
  ]

  const span: LineSpan = {
    kind: "subject-mention",
    from: index,
    to,
    hidden,
    text: stripHidden(text, index, to, hidden),
    binding: resolveBinding(cast, name),
  }

  return { kind: "emit", span, next: to }
}

// An opening quote bound by `[Name]` marks the whole quoted run as written by
// that character; `[Name]` plus one trailing space hides. An unbound quote is
// ordinary prose, so we step past the quote mark and keep scanning its inside.
function atQuote(text: string, index: number, closer: string, cast: Cast): Step {
  switch (text[index + 1] === "[") {
    case false:
      return { kind: "advance", next: index + 1 }
    case true:
      break
  }

  const bracket = readBracket(text, index + 1)

  switch (bracket.kind) {
    case "none":
      return { kind: "advance", next: index + 1 }
    case "some":
      return writtenSpan(text, index, closer, bracket.name, bracket.close, cast)
  }
}

function writtenSpan(text: string, index: number, closer: string, name: string, close: number, cast: Cast): Step {
  const hideEnd = extendSpace(text, close + 1)
  const runEnd = quoteEnd(text, closer, close + 1)
  const hidden: readonly Range[] = [{ from: index + 1, to: hideEnd }]

  const span: LineSpan = {
    kind: "character-written",
    from: index,
    to: runEnd,
    hidden,
    text: stripHidden(text, index, runEnd, hidden),
    binding: resolveBinding(cast, name),
  }

  return { kind: "emit", span, next: runEnd }
}

// A quoted run that finds no closing mark on its line still stays within the
// line — spans never straddle lines — so it ends at the line's end.
function quoteEnd(text: string, closer: string, start: number): number {
  const index = text.indexOf(closer, start)

  switch (index < 0) {
    case true:
      return text.length
    case false:
      return index + 1
  }
}

function readBracket(text: string, open: number): Bracket {
  const close = text.indexOf("]", open + 1)

  switch (close < 0) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", name: text.slice(open + 1, close), close }
  }
}

// The one space that trails a binding is part of the sigil, so it hides too —
// but only when it is actually there.
function extendSpace(text: string, index: number): number {
  switch (text[index] === " ") {
    case true:
      return index + 1
    case false:
      return index
  }
}

// The visible text of a span: its characters with every hidden range removed.
// Hidden ranges are ascending and lie within [from, to).
function stripHidden(text: string, from: number, to: number, hidden: readonly Range[]): string {
  let result = ""
  let cursor = from

  for (const range of hidden) {
    result += text.slice(cursor, range.from)
    cursor = range.to
  }

  result += text.slice(cursor, to)

  return result
}
