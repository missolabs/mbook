// Inline typography for the body of the book: headings gain their size and centring
// and shed their `#` marks; a `---` thematic break becomes a three-dot ornament;
// emphasis and strong drop their `*` fences. Every one of these is a same-line
// operation (line classes, or inline replacements that never cross a break), so
// they belong in a ViewPlugin rather than a StateField.
//
// Each decoration lifts the moment the cursor touches it: headings and rules reveal
// on a full-line touch, emphasis on a touch of its own exact span. The frontmatter
// fence is off-limits here — the StateField owns it — so nodes inside it are skipped.

import { RangeSetBuilder } from "@codemirror/state"
import type { Range } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import type { EditorState } from "@codemirror/state"
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common"

import { frontmatterSpan } from "./frontmatter-span"
import type { FrontmatterSpan } from "./frontmatter-span"
import { revealed } from "./reveal"
import type { Span } from "./reveal"

type MarkSpan = { kind: "found"; from: number; to: number } | { kind: "absent" }

class OrnamentWidget extends WidgetType {
  eq(): boolean {
    // Stateless: every ornament is the same three dots, so no DOM ever needs replacing.
    return true
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "mb-ornament"
    span.textContent = "· · ·"

    return span
  }
}

// The author line of the title page, drawn beneath the book title from the
// frontmatter's author field. An inline widget styled display:block — block
// decorations are a StateField privilege, but a block-styled span inside the
// title's own line lays out the same way.
class AuthorWidget extends WidgetType {
  private readonly author: string

  constructor(author: string) {
    super()

    this.author = author
  }

  override eq(other: AuthorWidget): boolean {
    return this.author === other.author
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "mb-author"
    span.textContent = this.author

    return span
  }
}

// The chapter's number, derived from its position among the chapters — the
// manuscript carries only the chapter's name; the numbering is the app's job.
class EyebrowWidget extends WidgetType {
  private readonly ordinal: number

  constructor(ordinal: number) {
    super()

    this.ordinal = ordinal
  }

  override eq(other: EyebrowWidget): boolean {
    return this.ordinal === other.ordinal
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "mb-chapter-eyebrow"
    span.textContent = `Capítulo ${this.ordinal}`

    return span
  }
}

function build(view: EditorView): DecorationSet {
  const fm = frontmatterSpan(view.state)
  const author = fmField(fm, "author")
  const chapterStarts = chapterHeadingStarts(view.state)
  const items: Range<Decoration>[] = []

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => collect(view.state, fm, author, chapterStarts, node, items),
    })
  }

  return sorted(items)
}

// Chapter ordinals count every heading in the document, not just the visible
// ones — a chapter's number must not depend on where the viewport sits.
function chapterHeadingStarts(state: EditorState): readonly number[] {
  const starts: number[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case "ATXHeading2":
          starts.push(node.from)
          return
        default:
          return
      }
    },
  })

  return starts
}

function fmField(fm: FrontmatterSpan, key: string): string {
  switch (fm.kind) {
    case "none":
      return ""
    case "some":
      break
  }

  const entry = fm.fields.find(([name]) => name === key)

  switch (entry) {
    case undefined:
      return ""
    default:
      return entry[1]
  }
}

function sorted(items: readonly Range<Decoration>[]): DecorationSet {
  // RangeSetBuilder demands strictly ascending positions; a line decoration and a
  // mark replacement can share a start offset (both at line.from), so we sort the
  // whole batch — by position, then by decoration's own start side — before adding.
  const ordered = [...items].sort(byPosition)
  const builder = new RangeSetBuilder<Decoration>()

  for (const item of ordered) {
    builder.add(item.from, item.to, item.value)
  }

  return builder.finish()
}

function byPosition(a: Range<Decoration>, b: Range<Decoration>): number {
  switch (a.from === b.from) {
    case false:
      return a.from - b.from
    case true:
      return a.value.startSide - b.value.startSide
  }
}

function collect(
  state: EditorState,
  fm: FrontmatterSpan,
  author: string,
  chapterStarts: readonly number[],
  node: SyntaxNodeRef,
  items: Range<Decoration>[],
): void {
  switch (insideFrontmatter(fm, node.from)) {
    case true:
      return
    case false:
      break
  }

  switch (node.name) {
    case "ATXHeading1":
      heading(state, node, "mb-title", items)

      authorLine(state, node, author, items)

      return
    case "ATXHeading2":
      heading(state, node, "mb-chapter", items)

      eyebrow(state, node, chapterStarts, items)

      return
    case "HorizontalRule":
      rule(state, node, items)
      return
    case "Blockquote":
      quote(state, node, items)
      return
    case "Paragraph":
      centered(state, node, items)
      return
    case "Emphasis":
      emphasis(state, node, items)
      return
    case "StrongEmphasis":
      emphasis(state, node, items)
      return
    default:
      return
  }
}

function heading(state: EditorState, node: SyntaxNodeRef, cls: string, items: Range<Decoration>[]): void {
  const line = state.doc.lineAt(node.from)

  items.push(Decoration.line({ class: cls }).range(line.from))

  const lineSpan: Span = { from: line.from, to: line.to }

  switch (revealed(selectionSpans(state), lineSpan)) {
    case true:
      return
    case false:
      break
  }

  const mark = headerMark(node.node)

  switch (mark.kind) {
    case "absent":
      return
    case "found": {
      const stop = Math.min(mark.to + 1, line.to)
      items.push(Decoration.replace({}).range(mark.from, stop))
      return
    }
  }
}

function authorLine(state: EditorState, node: SyntaxNodeRef, author: string, items: Range<Decoration>[]): void {
  switch (author === "") {
    case true:
      return
    case false:
      break
  }

  const line = state.doc.lineAt(node.from)

  items.push(Decoration.widget({ widget: new AuthorWidget(author), side: 1 }).range(line.to))
}

function eyebrow(
  state: EditorState,
  node: SyntaxNodeRef,
  chapterStarts: readonly number[],
  items: Range<Decoration>[],
): void {
  const ordinal = chapterStarts.indexOf(node.from) + 1

  switch (ordinal === 0) {
    case true:
      return
    case false:
      break
  }

  const line = state.doc.lineAt(node.from)

  items.push(Decoration.widget({ widget: new EyebrowWidget(ordinal), side: -1 }).range(line.from))
}

function rule(state: EditorState, node: SyntaxNodeRef, items: Range<Decoration>[]): void {
  const line = state.doc.lineAt(node.from)
  const lineSpan: Span = { from: line.from, to: line.to }

  switch (revealed(selectionSpans(state), lineSpan)) {
    case true:
      return
    case false:
      break
  }

  items.push(Decoration.replace({ widget: new OrnamentWidget() }).range(node.from, node.to))
}

// A block quotation — the set-book extract: every line of the quote carries
// mb-quote (indented both sides, slightly smaller), and each line's "> " mark
// lifts unless the cursor touches that line.
function quote(state: EditorState, node: SyntaxNodeRef, items: Range<Decoration>[]): void {
  const firstLine = state.doc.lineAt(node.from).number
  const lastLine = state.doc.lineAt(node.to).number

  for (let n = firstLine; n <= lastLine; n += 1) {
    const line = state.doc.line(n)

    items.push(Decoration.line({ class: "mb-quote" }).range(line.from))

    const lineSpan: Span = { from: line.from, to: line.to }

    switch (revealed(selectionSpans(state), lineSpan)) {
      case true:
        continue
      case false:
        break
    }

    const mark = quoteMarkLength(line.text)

    switch (mark === 0) {
      case true:
        continue
      case false:
        items.push(Decoration.replace({}).range(line.from, line.from + mark))
        continue
    }
  }
}

function quoteMarkLength(text: string): number {
  switch (text.startsWith("> ")) {
    case true:
      return 2
    case false:
      break
  }

  switch (text.startsWith(">")) {
    case true:
      return 1
    case false:
      return 0
  }
}

// A centred line, iA-Writer style: "-> dedication <-". The paragraph centres
// on the measure and its arrow marks lift unless the cursor touches the line.
const CENTER_PATTERN = /^->\s?([\s\S]*?)\s?<-\s*$/

function centered(state: EditorState, node: SyntaxNodeRef, items: Range<Decoration>[]): void {
  const line = state.doc.lineAt(node.from)

  const match = CENTER_PATTERN.exec(line.text)

  switch (match === null) {
    case true:
      return
    case false:
      break
  }

  items.push(Decoration.line({ class: "mb-center" }).range(line.from))

  const lineSpan: Span = { from: line.from, to: line.to }

  switch (revealed(selectionSpans(state), lineSpan)) {
    case true:
      return
    case false:
      break
  }

  const leading = line.text.length - line.text.replace(/^->\s?/, "").length
  const trailing = line.text.length - line.text.replace(/\s?<-\s*$/, "").length

  items.push(Decoration.replace({}).range(line.from, line.from + leading))

  items.push(Decoration.replace({}).range(line.to - trailing, line.to))
}

function emphasis(state: EditorState, node: SyntaxNodeRef, items: Range<Decoration>[]): void {
  const nodeSpan: Span = { from: node.from, to: node.to }

  switch (revealed(selectionSpans(state), nodeSpan)) {
    case true:
      return
    case false:
      break
  }

  for (const mark of emphasisMarks(node.node)) {
    items.push(Decoration.replace({}).range(mark.from, mark.to))
  }
}

function headerMark(node: SyntaxNode): MarkSpan {
  const child = node.getChild("HeaderMark")

  if (child === null) {
    return { kind: "absent" }
  }

  return { kind: "found", from: child.from, to: child.to }
}

function emphasisMarks(node: SyntaxNode): readonly { from: number; to: number }[] {
  return node.getChildren("EmphasisMark").map((child) => ({ from: child.from, to: child.to }))
}

function insideFrontmatter(fm: FrontmatterSpan, at: number): boolean {
  switch (fm.kind) {
    case "none":
      return false
    case "some":
      return at >= fm.from && at <= fm.to
  }
}

function selectionSpans(state: EditorState): readonly Span[] {
  return state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
}

export const structurePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate): void {
      switch (update.docChanged || update.selectionSet || update.viewportChanged) {
        case true:
          this.decorations = build(update.view)
          return
        case false:
          return
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
