import { describe, it, expect } from "bun:test"

import { PageTracker } from "../../src/renderer/page-tracker"
import type { StatusState } from "../../src/renderer/statusbar"
import { parseBookDoc } from "../../src/shared/book/parse"
import { paginate, pageAtLine } from "../../src/shared/book/pagination"
import { BOOK_LINES, LINE } from "./fixture"

// The statusbar half PageTracker feeds: a recording fake stands in for the real
// render seam so the emitted counts can be asserted without a DOM.
function record() {
  const emitted: StatusState["counts"][] = []

  return {
    emitted,
    setCounts: (counts: StatusState["counts"]) => {
      emitted.push(counts)
    },
  }
}

function lastCounts(emitted: StatusState["counts"][]): StatusState["counts"] {
  const last = emitted[emitted.length - 1]

  switch (last) {
    case undefined:
      throw new Error("no counts emitted")
    default:
      return last
  }
}

describe("PageTracker", () => {
  it("emits the page-at-cursor, total pages and word count for a chapter-two line", () => {
    const sink = record()

    const tracker = new PageTracker()
    tracker.recompute(BOOK_LINES)

    sink.setCounts(tracker.counts(LINE.lastPara))

    const counts = lastCounts(sink.emitted)

    const expectedPage = pageAtLine(paginate(parseBookDoc(BOOK_LINES)), LINE.lastPara)

    switch (counts.kind) {
      case "empty":
        throw new Error("expected counted, got empty")
      case "counted": {
        expect(counts.page).toBe(expectedPage)
        expect(counts.totalPages).toBeGreaterThan(1)
        expect(counts.words).toBeGreaterThan(0)
        break
      }
    }
  })

  it("re-reads the cached page for a caret move without re-paginating", () => {
    const tracker = new PageTracker()
    tracker.recompute(BOOK_LINES)

    const atTitle = tracker.pageAtCursorLine(LINE.bookTitle)
    const atChapterTwo = tracker.pageAtCursorLine(LINE.chapterDois)

    expect(atTitle).toBe(1)
    expect(atChapterTwo).toBeGreaterThan(atTitle)
  })
})
