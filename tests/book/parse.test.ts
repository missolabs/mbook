import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import type { Block } from "../../src/shared/book/parse"
import { BOOK_LINES, LINE } from "./fixture"

function kindsOf(blocks: readonly Block[]): readonly string[] {
  return blocks.map((block) => block.kind)
}

function blockAt(blocks: readonly Block[], line: number): Block {
  const found = blocks.find((block) => {
    switch (block.kind) {
      case "frontmatter":
        return line >= block.fromLine && line <= block.toLine
      case "paragraph":
        return line >= block.fromLine && line <= block.toLine
      case "book-title":
        return block.line === line
      case "chapter-title":
        return block.line === line
      case "separator":
        return block.line === line
      case "blank":
        return block.line === line
    }
  })

  switch (found === undefined) {
    case true:
      throw new Error(`no block at line ${line}`)
    case false:
      return found
  }
}

describe("parseBookDoc", () => {
  it("yields blocks in document order with the right kinds", () => {
    const doc = parseBookDoc(BOOK_LINES)

    expect(kindsOf(doc.blocks)).toEqual([
      "frontmatter",
      "book-title",
      "blank",
      "chapter-title",
      "blank",
      "paragraph",
      "blank",
      "paragraph",
      "blank",
      "separator",
      "blank",
      "chapter-title",
      "blank",
      "paragraph",
      "blank",
      "paragraph",
    ])
    expect(doc.lineCount).toBe(BOOK_LINES.length)
  })

  it("reads frontmatter fields, splitting on the first colon", () => {
    const doc = parseBookDoc(BOOK_LINES)
    const front = blockAt(doc.blocks, 0)

    switch (front.kind) {
      case "frontmatter":
        expect(front.fromLine).toBe(0)
        expect(front.toLine).toBe(3)
        expect(front.fields).toEqual([
          ["title", "O Jardim"],
          ["author", "Enzo Ferrari"],
        ])
        break
      default:
        throw new Error("expected frontmatter")
    }
  })

  it("merges consecutive prose lines into one paragraph", () => {
    const doc = parseBookDoc(BOOK_LINES)
    const para = blockAt(doc.blocks, LINE.proseRun)

    switch (para.kind) {
      case "paragraph":
        expect(para.fromLine).toBe(8)
        expect(para.toLine).toBe(9)
        expect(para.wordCount).toBe(8)
        break
      default:
        throw new Error("expected paragraph")
    }
  })

  it("treats a travessão dialogue line as a paragraph", () => {
    const doc = parseBookDoc(BOOK_LINES)
    expect(blockAt(doc.blocks, LINE.dialogue).kind).toBe("paragraph")
  })

  it("recognizes a bare --- outside frontmatter as a separator", () => {
    const doc = parseBookDoc(BOOK_LINES)
    expect(blockAt(doc.blocks, LINE.separator).kind).toBe("separator")
  })

  it("treats a ### line as ordinary prose, not a heading", () => {
    const doc = parseBookDoc(BOOK_LINES)
    const block = blockAt(doc.blocks, LINE.hashRun)

    switch (block.kind) {
      case "paragraph":
        expect(block.wordCount).toBe(3)
        break
      default:
        throw new Error("expected ### to be a paragraph")
    }
  })

  it("emits no frontmatter block when line 0 is not ---", () => {
    const doc = parseBookDoc(["# Hi", "", "Só texto."])

    expect(kindsOf(doc.blocks)).toEqual(["book-title", "blank", "paragraph"])
  })

  it("emits no frontmatter block when the fence is never closed", () => {
    const doc = parseBookDoc(["---", "title: X", "# Aberto"])

    // The unclosed opener is just a bare --- again: a separator, not frontmatter.
    expect(kindsOf(doc.blocks)).toEqual(["separator", "paragraph", "book-title"])
  })

  it("returns an empty block stream for an empty document", () => {
    const doc = parseBookDoc([])

    expect(doc.blocks).toEqual([])
    expect(doc.lineCount).toBe(0)
  })
})
