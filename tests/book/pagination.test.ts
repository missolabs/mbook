import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { paginate, pageAtLine } from "../../src/shared/book/pagination"
import type { PageMap } from "../../src/shared/book/pagination"
import { BOOK_LINES, LINE } from "./fixture"

function entryPage(map: PageMap, line: number): number {
  const entry = map.entries.find((e) => line >= e.fromLine && line <= e.toLine)

  switch (entry === undefined) {
    case true:
      throw new Error(`no entry for line ${line}`)
    case false:
      return entry.page
  }
}

describe("paginate", () => {
  it("gives the book title page 1 to itself, next content on a fresh page", () => {
    const map = paginate(parseBookDoc(BOOK_LINES))

    expect(entryPage(map, LINE.bookTitle)).toBe(1)
    expect(entryPage(map, LINE.chapterUm)).toBe(2)
  })

  it("starts chapter two past every page chapter one's content touched", () => {
    const map = paginate(parseBookDoc(BOOK_LINES))

    const chapterOnePages = [LINE.chapterUm, LINE.proseRun, LINE.dialogue, LINE.separator].map((line) =>
      entryPage(map, line),
    )
    const chapterTwoPage = entryPage(map, LINE.chapterDois)

    expect(chapterTwoPage).toBeGreaterThan(Math.max(...chapterOnePages))
  })

  it("maps a chapter's first line to that chapter's start page", () => {
    const map = paginate(parseBookDoc(BOOK_LINES))

    expect(pageAtLine(map, LINE.chapterUm)).toBe(entryPage(map, LINE.chapterUm))
    expect(pageAtLine(map, LINE.chapterDois)).toBe(entryPage(map, LINE.chapterDois))
  })

  it("returns the last page for a line past the document", () => {
    const map = paginate(parseBookDoc(BOOK_LINES))

    expect(pageAtLine(map, BOOK_LINES.length + 50)).toBe(map.totalPages)
  })

  it("grows the page count when a long paragraph is appended", () => {
    const base = paginate(parseBookDoc(BOOK_LINES))
    const longLine = "palavra ".repeat(400).trim()
    const grown = paginate(parseBookDoc([...BOOK_LINES, "", longLine]))

    expect(longLine.length).toBeGreaterThan(3000)
    expect(grown.totalPages).toBeGreaterThan(base.totalPages)
  })

  it("reports a single page for an empty document", () => {
    expect(paginate(parseBookDoc([])).totalPages).toBe(1)
  })
})
