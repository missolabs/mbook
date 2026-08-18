// Manuscript word count: prose only. Titles, frontmatter and separators do not
// count toward the reader's word total.

import type { BookDoc, Block } from "./parse"
import { assertNever } from "../assert"

export function countWords(doc: BookDoc): number {
  return doc.blocks.reduce((sum, block) => sum + wordsIn(block), 0)
}

function wordsIn(block: Block): number {
  switch (block.kind) {
    case "paragraph":
      return block.wordCount
    case "frontmatter":
      return 0
    case "book-title":
      return 0
    case "chapter-title":
      return 0
    case "separator":
      return 0
    case "blank":
      return 0
    default:
      return assertNever(block)
  }
}
