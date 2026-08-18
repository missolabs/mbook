// The navigator's view of a book: its chapters in order, and which one a given
// cursor line falls under. Pure projections of an already-parsed BookDoc.

import type { BookDoc } from "./parse"
import type { Optional } from "../optional"

export type Chapter = { title: string; line: number }

export function chapterList(doc: BookDoc): readonly Chapter[] {
  const chapters: Chapter[] = []

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "chapter-title":
        chapters.push({ title: block.text, line: block.line })
        continue
      default:
        continue
    }
  }

  return chapters
}

export function chapterAtLine(chapters: readonly Chapter[], line: number): Optional<number> {
  let found: Optional<number> = { kind: "none" }

  chapters.forEach((chapter, index) => {
    switch (chapter.line <= line) {
      case true:
        found = { kind: "some", value: index }
        return
      case false:
        return
    }
  })

  return found
}
