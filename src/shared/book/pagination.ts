// A5 page estimator for a parsed book. Pure fold over the block stream.
//
// The estimate models the page AS RENDERED in the editor, because the editor
// draws each page as its own A5 sheet — the sheet heights are only honest if
// the model counts what the screen shows. Derivation of the layout constants:
//   A5 page 148 x 210 mm; margins top 19 / bottom 22 / sides 16.5
//     -> text block 115 x 169 mm (434.6 x 638.9 px at 96 dpi).
//   Literata 17.5 px on 1.7 leading = 29.75 px/line -> 638.9 / 29.75 ~= 21 lines.
//   Average advance ~= 0.5 em of 17.5 px = 8.75 px/char -> 434.6 / 8.75 ~= 49 chars.
//   A blank source line renders as one empty line on screen, so it consumes one.
//   A chapter opening (2em air + 1.25em title + 0.9em air) ~= 3 lines.
//   A decorative separator with air above and below ~= 3 lines.

import type { BookDoc, Block } from "./parse"
import { assertNever } from "../assert"

export const LINES_PER_PAGE = 21
export const CHARS_PER_LINE = 49
export const CHAPTER_HEAD_LINES = 3
export const SEPARATOR_LINES = 3

export type PageEntry = { fromLine: number; toLine: number; page: number }

// A minimap-ready abstraction of one laid-out page: every slot of the page's
// 30-line grid is either empty or a mark whose width fraction mirrors how much
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

type Fold = { page: number; lineInPage: number; totalPages: number }
type Step = { entry: PageEntry; fold: Fold }
type Cursor = { page: number; lineInPage: number }
type Span = { page: number; lineInPage: number; lastPage: number }
type RowSink = SkeletonRow[][]

const GAP: SkeletonRow = { kind: "gap", fill: 0 }

export function paginate(doc: BookDoc): PageMap {
  const initial: Fold = { page: 1, lineInPage: 0, totalPages: 1 }
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

// A blank line is real vertical space on the rendered sheet: one empty line of
// leading. It leaves its row as a gap in the skeleton rather than marking it.
// At the top of a page it consumes nothing — whitespace there is absorbed into
// the head margin, as in print.
function blankStep(fold: Fold, line: number): Step {
  switch (fold.lineInPage === 0) {
    case true:
      return zeroLineStep(fold, line, line)
    case false:
      break
  }

  const span = consume(fold.page, fold.lineInPage, 1)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  return {
    entry: { fromLine: line, toLine: line, page: fold.page },
    fold: { page: span.page, lineInPage: span.lineInPage, totalPages },
  }
}

function titleStep(fold: Fold, line: number, sink: RowSink): Step {
  const start = freshPage(fold)
  const totalPages = Math.max(fold.totalPages, start)

  // A title page carries its mark in the upper third, the classic half-title.
  setRow(sink, start, 7, { kind: "title", fill: 0.62 })

  return {
    entry: { fromLine: line, toLine: line, page: start },
    fold: { page: start + 1, lineInPage: 0, totalPages },
  }
}

function chapterStep(fold: Fold, line: number, sink: RowSink): Step {
  const start = freshPage(fold)
  const span = consume(start, 0, CHAPTER_HEAD_LINES)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  setRow(sink, start, 1, { kind: "chapter", fill: 0.5 })

  return {
    entry: { fromLine: line, toLine: line, page: start },
    fold: { page: span.page, lineInPage: span.lineInPage, totalPages },
  }
}

function separatorStep(fold: Fold, line: number, sink: RowSink): Step {
  const landing = fitStart(fold, SEPARATOR_LINES)
  const span = consume(landing.page, landing.lineInPage, SEPARATOR_LINES)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  setRow(sink, landing.page, landing.lineInPage + 1, { kind: "ornament", fill: 0.18 })

  return {
    entry: { fromLine: line, toLine: line, page: landing.page },
    fold: { page: span.page, lineInPage: span.lineInPage, totalPages },
  }
}

function paragraphStep(fold: Fold, block: Extract<Block, { kind: "paragraph" }>, sink: RowSink): Step {
  const linesFor = Math.max(1, Math.ceil(block.charCount / CHARS_PER_LINE))
  const span = consume(fold.page, fold.lineInPage, linesFor)
  const totalPages = Math.max(fold.totalPages, span.lastPage)

  for (let i = 0; i < linesFor; i += 1) {
    const at = consume(fold.page, fold.lineInPage, i)

    setRow(sink, at.page, at.lineInPage, { kind: "text", fill: lineFill(block.charCount, i, linesFor) })
  }

  return {
    entry: { fromLine: block.fromLine, toLine: block.toLine, page: fold.page },
    fold: { page: span.page, lineInPage: span.lineInPage, totalPages },
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

function setRow(sink: RowSink, page: number, lineInPage: number, row: SkeletonRow): void {
  const rows = pageRows(sink, page)

  rows[lineInPage] = row
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

function freshPage(fold: Fold): number {
  switch (fold.lineInPage === 0) {
    case true:
      return fold.page
    case false:
      return fold.page + 1
  }
}

function fitStart(fold: Fold, count: number): Cursor {
  switch (fold.lineInPage + count <= LINES_PER_PAGE) {
    case true:
      return { page: fold.page, lineInPage: fold.lineInPage }
    case false:
      return { page: fold.page + 1, lineInPage: 0 }
  }
}

function consume(startPage: number, startLine: number, count: number): Span {
  const total = startLine + count
  const page = startPage + Math.floor(total / LINES_PER_PAGE)
  const lineInPage = total % LINES_PER_PAGE
  const lastPage = startPage + Math.floor((startLine + count - 1) / LINES_PER_PAGE)

  return { page, lineInPage, lastPage }
}
