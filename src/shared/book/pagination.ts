// A5 page estimator for a parsed book. Pure fold over the block stream.
//
// The estimate models the page AS RENDERED in the editor, because the editor
// draws each page as its own A5 sheet — the sheet heights are only honest if
// the model counts what the screen shows. Derivation of the layout constants:
//   A5 page 148 x 210 mm; margins top 19 / bottom 22 / sides 16.5
//     -> text block 115 x 169 mm (434.6 x 638.9 px at 96 dpi).
//   Literata 17.5 px on 1.6 leading = 28 px/line -> 638.9 / 28 ~= 22 lines.
//   Average advance ~= 0.5 em of 17.5 px = 8.75 px/char -> 434.6 / 8.75 ~= 49 chars.
//   The fold counts in HALF-LINE units: a text line is 2 units, and a blank
//   source line renders at half a line (mb-blank), so it consumes 1. A page
//   holding only blanks is still "fresh" — a title or chapter claims it
//   rather than leaking onto the next page.
//   A chapter opening measures ~3.5 lines (7 units); a separator ~3 (6).

import type { BookDoc, Block } from "./parse"
import { assertNever } from "../assert"

export const LINES_PER_PAGE = 22
export const CHARS_PER_LINE = 49

const UNITS_PER_LINE = 2
const UNITS_PER_PAGE = LINES_PER_PAGE * UNITS_PER_LINE
const BLANK_UNITS = 1
// Measured: 2em air + the numbering eyebrow + 1.25em title + 0.9em air.
const CHAPTER_HEAD_UNITS = 5
const SEPARATOR_UNITS = 6

export type PageEntry = { fromLine: number; toLine: number; page: number }

// A minimap-ready abstraction of one laid-out page: every slot of the page's
// line grid is either empty or a mark whose width fraction mirrors how much
// of the measure that line of the estimate occupies.
export type SkeletonRow = {
  kind: "gap" | "text" | "chapter" | "title" | "ornament"
  fill: number
}

export type PageMap = {
  totalPages: number
  entries: readonly PageEntry[]
  pages: readonly (readonly SkeletonRow[])[]
}

type Fold = { page: number; unitInPage: number; totalPages: number; content: boolean }
type Step = { entry: PageEntry; fold: Fold }
type Cursor = { page: number; unitInPage: number }
type Span = { page: number; unitInPage: number; lastPage: number }
type RowSink = SkeletonRow[][]

const GAP: SkeletonRow = { kind: "gap", fill: 0 }

export function paginate(doc: BookDoc): PageMap {
  const initial: Fold = { page: 1, unitInPage: 0, totalPages: 1, content: false }
  const entries: PageEntry[] = []
  const sink: RowSink = []

  const finalFold = doc.blocks.reduce((fold, block) => {
    const step = placeBlock(fold, block, sink)
    entries.push(step.entry)
    return step.fold
  }, initial)

  return { totalPages: finalFold.totalPages, entries, pages: pagesFrom(sink, finalFold.totalPages) }
}

export function firstLineOfPage(map: PageMap, page: number): number {
  for (const entry of map.entries) {
    switch (entry.page >= page) {
      case true:
        return entry.fromLine
      case false:
        continue
    }
  }

  return 0
}

export function pageAtLine(map: PageMap, line: number): number {
  let lo = 0
  let hi = map.entries.length - 1

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const entry = map.entries[mid]

    if (entry === undefined) {
      return map.totalPages
    }

    switch (line < entry.fromLine) {
      case true:
        hi = mid - 1
        continue
      case false:
        break
    }

    switch (line > entry.toLine) {
      case true:
        lo = mid + 1
        continue
      case false:
        return entry.page
    }
  }

  return map.totalPages
}

function placeBlock(fold: Fold, block: Block, sink: RowSink): Step {
  switch (block.kind) {
    case "frontmatter":
      return zeroLineStep(fold, block.fromLine, block.toLine)
    case "blank":
      return blankStep(fold, block.line)
    case "book-title":
      return titleStep(fold, block.line, sink)
    case "chapter-title":
      return chapterStep(fold, block.line, sink)
    case "separator":
      return separatorStep(fold, block.line, sink)
    case "paragraph":
      return paragraphStep(fold, block, sink)
    default:
      return assertNever(block)
  }
}

function zeroLineStep(fold: Fold, fromLine: number, toLine: number): Step {
  return { entry: { fromLine, toLine, page: fold.page }, fold }
}

// A blank line renders at half a line of leading (mb-blank), so it consumes
// one half-line unit wherever it falls — the renderer does not absorb page-top
// whitespace, so neither does the model. A run of blanks never claims a page:
// freshPage treats a page without content as still fresh.
function blankStep(fold: Fold, line: number): Step {
  const span = consume(fold.page, fold.unitInPage, BLANK_UNITS)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  return {
    entry: { fromLine: line, toLine: line, page: fold.page },
    fold: { page: span.page, unitInPage: span.unitInPage, totalPages, content: fold.content && span.page === fold.page },
  }
}

function titleStep(fold: Fold, line: number, sink: RowSink): Step {
  const start = freshPage(fold)
  const totalPages = Math.max(fold.totalPages, start)

  // A title page carries its mark in the upper third, the classic half-title.
  setRow(sink, start, 7, { kind: "title", fill: 0.62 })

  return {
    entry: { fromLine: line, toLine: line, page: start },
    fold: { page: start + 1, unitInPage: 0, totalPages, content: false },
  }
}

function chapterStep(fold: Fold, line: number, sink: RowSink): Step {
  const start = freshPage(fold)
  const span = consume(start, 0, CHAPTER_HEAD_UNITS)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  setRow(sink, start, 1, { kind: "chapter", fill: 0.5 })

  return {
    entry: { fromLine: line, toLine: line, page: start },
    fold: { page: span.page, unitInPage: span.unitInPage, totalPages, content: true },
  }
}

function separatorStep(fold: Fold, line: number, sink: RowSink): Step {
  const landing = fitStart(fold, SEPARATOR_UNITS)
  const span = consume(landing.page, landing.unitInPage, SEPARATOR_UNITS)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  setRow(sink, landing.page, rowOf(landing.unitInPage) + 1, { kind: "ornament", fill: 0.18 })

  return {
    entry: { fromLine: line, toLine: line, page: landing.page },
    fold: { page: span.page, unitInPage: span.unitInPage, totalPages, content: true },
  }
}

// Keep-together: the editor cannot split a paragraph across two sheets, so a
// paragraph that no longer fits the page moves to the next one whole — the
// short page gets fill, and every sheet stays a true A5. Only a paragraph
// taller than a full page is allowed to straddle (its sheet stretches).
function paragraphStep(fold: Fold, block: Extract<Block, { kind: "paragraph" }>, sink: RowSink): Step {
  const linesFor = Math.max(1, Math.ceil(block.charCount / CHARS_PER_LINE))
  const units = linesFor * UNITS_PER_LINE

  const landing = paragraphLanding(fold, units)

  const span = consume(landing.page, landing.unitInPage, units)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  for (let i = 0; i < linesFor; i += 1) {
    const at = consume(landing.page, landing.unitInPage, i * UNITS_PER_LINE)

    setRow(sink, at.page, rowOf(at.unitInPage), { kind: "text", fill: lineFill(block.charCount, i, linesFor) })
  }

  return {
    entry: { fromLine: block.fromLine, toLine: block.toLine, page: landing.page },
    fold: { page: span.page, unitInPage: span.unitInPage, totalPages, content: true },
  }
}

function paragraphLanding(fold: Fold, units: number): Cursor {
  switch (units > UNITS_PER_PAGE) {
    case true:
      return { page: fold.page, unitInPage: fold.unitInPage }
    case false:
      return fitStart(fold, units)
  }
}

function lineFill(charCount: number, index: number, linesFor: number): number {
  switch (index === linesFor - 1) {
    case false:
      return 1
    case true: {
      const rest = charCount % CHARS_PER_LINE

      switch (rest === 0) {
        case true:
          return 1
        case false:
          return Math.max(0.15, rest / CHARS_PER_LINE)
      }
    }
  }
}

function rowOf(unitInPage: number): number {
  return Math.floor(unitInPage / UNITS_PER_LINE)
}

function setRow(sink: RowSink, page: number, row: number, value: SkeletonRow): void {
  const rows = pageRows(sink, page)

  rows[Math.min(row, LINES_PER_PAGE - 1)] = value
}

function pageRows(sink: RowSink, page: number): SkeletonRow[] {
  const existing = sink[page - 1]

  if (existing !== undefined) {
    return existing
  }

  const fresh = Array.from({ length: LINES_PER_PAGE }, () => GAP)

  sink[page - 1] = fresh

  return fresh
}

function pagesFrom(sink: RowSink, totalPages: number): readonly (readonly SkeletonRow[])[] {
  return Array.from({ length: totalPages }, (_ignored: unknown, index) => {
    const rows = sink[index]

    if (rows !== undefined) {
      return rows
    }

    return Array.from({ length: LINES_PER_PAGE }, () => GAP)
  })
}

// A page holding no content yet — empty, or blanks only — is still fresh: a
// title or chapter claims it (its stray blank half-lines are covered by the
// sheet's fill) instead of leaking onto the next page.
function freshPage(fold: Fold): number {
  switch (fold.content) {
    case false:
      return fold.page
    case true:
      return fold.page + 1
  }
}

function fitStart(fold: Fold, units: number): Cursor {
  switch (fold.unitInPage + units <= UNITS_PER_PAGE) {
    case true:
      return { page: fold.page, unitInPage: fold.unitInPage }
    case false:
      return { page: fold.page + 1, unitInPage: 0 }
  }
}

function consume(startPage: number, startUnit: number, units: number): Span {
  const total = startUnit + units
  const page = startPage + Math.floor(total / UNITS_PER_PAGE)
  const unitInPage = total % UNITS_PER_PAGE
  const lastPage = startPage + Math.floor((startUnit + units - 1) / UNITS_PER_PAGE)

  return { page, unitInPage, lastPage }
}
