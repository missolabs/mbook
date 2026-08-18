import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { countWords } from "../../src/shared/book/words"
import { BOOK_LINES } from "./fixture"

describe("countWords", () => {
  it("counts prose only, excluding frontmatter, titles and separators", () => {
    const doc = parseBookDoc(BOOK_LINES)

    // 8 (merged run) + 5 (dialogue) + 3 (### line) + 3 (last paragraph).
    expect(countWords(doc)).toBe(19)
  })

  it("is unchanged by adding a many-word title", () => {
    const withHeading = parseBookDoc([...BOOK_LINES, "", "## Um Título Com Muitas Palavras"])

    expect(countWords(withHeading)).toBe(19)
  })
})
