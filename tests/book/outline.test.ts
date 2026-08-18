import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { paginate, pageAtLine, firstLineOfPage, LINES_PER_PAGE } from "../../src/shared/book/pagination"
import { chapterList, chapterAtLine } from "../../src/shared/book/outline"
import { BOOK_LINES, LINE } from "./fixture"

const doc = parseBookDoc(BOOK_LINES)
const chapters = chapterList(doc)

describe("chapterList", () => {
  it("lists both chapters in order with their lines", () => {
    expect(chapters).toEqual([
      { title: "Capítulo Um", line: LINE.chapterUm },
      { title: "Capítulo Dois", line: LINE.chapterDois },
    ])
  })
})

describe("chapterAtLine", () => {
  it("is none before the first chapter", () => {
    expect(chapterAtLine(chapters, LINE.bookTitle)).toEqual({ kind: "none" })
  })

  it("is the first chapter from its own line up to the next", () => {
    expect(chapterAtLine(chapters, LINE.chapterUm)).toEqual({ kind: "some", value: 0 })

    expect(chapterAtLine(chapters, LINE.separator)).toEqual({ kind: "some", value: 0 })
  })

  it("is the last chapter for lines after it", () => {
    expect(chapterAtLine(chapters, LINE.lastPara)).toEqual({ kind: "some", value: 1 })
  })
})

describe("page skeletons", () => {
  const map = paginate(doc)

  it("emits one skeleton per page, each a full slot grid", () => {
    expect(map.pages.length).toBe(map.totalPages)

    for (const rows of map.pages) {
      expect(rows.length).toBe(LINES_PER_PAGE)
    }
  })

  it("marks the title page with a single centered title row", () => {
    const first = map.pages[0]

    if (first === undefined) {
      throw new Error("missing title page")
    }

    const kinds = first.map((row) => row.kind).filter((kind) => kind !== "gap")

    expect(kinds).toEqual(["title"])
  })

  it("opens a chapter page with the chapter mark and its prose", () => {
    const chapterPage = map.pages[1]

    if (chapterPage === undefined) {
      throw new Error("missing chapter page")
    }

    const kinds = chapterPage.map((row) => row.kind)

    expect(kinds[1]).toBe("chapter")

    expect(kinds).toContain("text")
  })
})

describe("firstLineOfPage", () => {
  const map = paginate(doc)

  it("answers the title line for the title page", () => {
    expect(firstLineOfPage(map, 1)).toBeLessThanOrEqual(LINE.bookTitle)
  })

  it("answers a line that lies on the requested page, at or before chapter one", () => {
    const line = firstLineOfPage(map, 2)

    expect(pageAtLine(map, line)).toBe(2)

    expect(line).toBeLessThanOrEqual(LINE.chapterUm)
  })
})
