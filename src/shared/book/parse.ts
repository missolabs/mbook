// Pure book-markdown parser. A book is one markdown file; this turns its lines
// into a flat, typed block stream. Single forward pass, no regex backtracking.

export type BookDoc = { blocks: readonly Block[]; lineCount: number }

export type Block =
  | { kind: "frontmatter"; fromLine: number; toLine: number; fields: readonly (readonly [string, string])[] }
  | { kind: "book-title"; line: number; text: string }
  | { kind: "chapter-title"; line: number; text: string }
  | { kind: "separator"; line: number }
  | { kind: "paragraph"; fromLine: number; toLine: number; charCount: number; wordCount: number }
  | { kind: "blank"; line: number }

type LineClass =
  | { kind: "book-title"; text: string }
  | { kind: "chapter-title"; text: string }
  | { kind: "separator" }
  | { kind: "blank" }
  | { kind: "text" }

type Front =
  | { kind: "none" }
  | { kind: "some"; toLine: number; fields: readonly (readonly [string, string])[] }

type MaybeField =
  | { kind: "field"; entry: readonly [string, string] }
  | { kind: "skip" }

export function parseBookDoc(lines: readonly string[]): BookDoc {
  const front = detectFrontmatter(lines)
  const start = frontmatterStart(front)

  const blocks: Block[] = []
  appendFrontmatter(blocks, front)

  const runLines: string[] = []
  let runStart = 0

  function flushRun(): void {
    switch (runLines.length === 0) {
      case true:
        return
      case false:
        blocks.push(makeParagraph(runStart, runLines))
        runLines.length = 0
        return
    }
  }

  for (const [index, line] of lines.entries()) {
    switch (index < start) {
      case true:
        continue
      case false:
        break
    }

    const cls = classifyLine(line)

    switch (cls.kind) {
      case "text": {
        switch (runLines.length === 0) {
          case true:
            runStart = index
            break
          case false:
            break
        }
        runLines.push(line)
        break
      }
      case "blank": {
        flushRun()
        blocks.push({ kind: "blank", line: index })
        break
      }
      case "separator": {
        flushRun()
        blocks.push({ kind: "separator", line: index })
        break
      }
      case "book-title": {
        flushRun()
        blocks.push({ kind: "book-title", line: index, text: cls.text })
        break
      }
      case "chapter-title": {
        flushRun()
        blocks.push({ kind: "chapter-title", line: index, text: cls.text })
        break
      }
    }
  }

  flushRun()

  return { blocks, lineCount: lines.length }
}

function classifyLine(line: string): LineClass {
  switch (line === "---") {
    case true:
      return { kind: "separator" }
    case false:
      break
  }

  switch (line.startsWith("## ")) {
    case true:
      return { kind: "chapter-title", text: line.slice(3) }
    case false:
      break
  }

  switch (line.startsWith("# ")) {
    case true:
      return { kind: "book-title", text: line.slice(2) }
    case false:
      break
  }

  switch (line.trim().length === 0) {
    case true:
      return { kind: "blank" }
    case false:
      return { kind: "text" }
  }
}

function makeParagraph(fromLine: number, runLines: readonly string[]): Block {
  // charCount models the joined paragraph: line lengths plus one space per join.
  const charCount = runLines.reduce((sum, line) => sum + line.length, 0) + (runLines.length - 1)
  const wordCount = runLines.reduce((sum, line) => sum + countTokens(line), 0)
  const toLine = fromLine + runLines.length - 1

  return { kind: "paragraph", fromLine, toLine, charCount, wordCount }
}

function countTokens(line: string): number {
  return line.split(/\s+/).filter((token) => token.length > 0).length
}

function detectFrontmatter(lines: readonly string[]): Front {
  const first = lines[0]

  switch (first === "---") {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const close = findClosing(lines)

  switch (close.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      return { kind: "some", toLine: close.value, fields: parseFields(lines, close.value) }
  }
}

type Closing = { kind: "none" } | { kind: "some"; value: number }

function findClosing(lines: readonly string[]): Closing {
  for (const [index, line] of lines.entries()) {
    switch (index === 0) {
      case true:
        continue
      case false:
        break
    }

    switch (line === "---") {
      case true:
        return { kind: "some", value: index }
      case false:
        break
    }
  }

  return { kind: "none" }
}

function parseFields(lines: readonly string[], closeIndex: number): readonly (readonly [string, string])[] {
  const fields: (readonly [string, string])[] = []

  for (const [index, line] of lines.entries()) {
    switch (index === 0 || index >= closeIndex) {
      case true:
        continue
      case false:
        break
    }

    const parsed = parseField(line)

    switch (parsed.kind) {
      case "skip":
        break
      case "field":
        fields.push(parsed.entry)
        break
    }
  }

  return fields
}

function parseField(line: string): MaybeField {
  const colon = line.indexOf(":")

  switch (colon < 0) {
    case true:
      return { kind: "skip" }
    case false:
      break
  }

  const key = line.slice(0, colon).trim()
  const value = line.slice(colon + 1).trim()
  const entry: readonly [string, string] = [key, value]

  return { kind: "field", entry }
}

function appendFrontmatter(blocks: Block[], front: Front): void {
  switch (front.kind) {
    case "none":
      return
    case "some":
      blocks.push({ kind: "frontmatter", fromLine: 0, toLine: front.toLine, fields: front.fields })
      return
  }
}

function frontmatterStart(front: Front): number {
  switch (front.kind) {
    case "none":
      return 0
    case "some":
      return front.toLine + 1
  }
}
