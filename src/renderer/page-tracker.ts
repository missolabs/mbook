// PageTracker keeps the derived book measurements — the A5 page map and the
// manuscript word count — current for the open document, and answers which page
// a cursor line falls on. It caches one paginated result so a selection move
// never re-parses: recompute() rebuilds the cache from lines (the debounced
// edit path), counts()/pageAtCursorLine() only read it (the immediate path).

import { parseBookDoc } from "../shared/book/parse"
import type { BookDoc } from "../shared/book/parse"
import { paginate, pageAtLine } from "../shared/book/pagination"
import type { PageMap } from "../shared/book/pagination"
import { countWords } from "../shared/book/words"
import type { StatusState } from "./statusbar"

export type TrackerSnapshot = { doc: BookDoc; pageMap: PageMap; words: number }

function compute(lines: readonly string[]): TrackerSnapshot {
  const doc = parseBookDoc(lines)

  return { doc, pageMap: paginate(doc), words: countWords(doc) }
}

export class PageTracker {
  private cache: TrackerSnapshot

  constructor() {
    this.cache = compute([])
  }

  recompute(lines: readonly string[]): void {
    this.cache = compute(lines)
  }

  snapshot(): TrackerSnapshot {
    return this.cache
  }

  pageAtCursorLine(zeroBasedLine: number): number {
    return pageAtLine(this.cache.pageMap, zeroBasedLine)
  }

  counts(zeroBasedLine: number): StatusState["counts"] {
    return {
      kind: "counted",
      page: this.pageAtCursorLine(zeroBasedLine),
      totalPages: this.cache.pageMap.totalPages,
      words: this.cache.words,
    }
  }
}
