// The frontmatter is collapsed, when idle, into a single metadata strip — a block
// widget that replaces the whole `--- … ---` fence with one small-caps line of
// title · author. Because that replacement spans line breaks and inserts a BLOCK
// widget, it MUST live in a StateField (a ViewPlugin may not cross line breaks).
// When the cursor enters the fence the strip dissolves and the raw YAML returns,
// dimmed via a per-line class.

import { StateField } from "@codemirror/state"
import type { EditorState, Extension } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"

import { frontmatterSpan } from "./frontmatter-span"
import type { FrontmatterSpan } from "./frontmatter-span"
import { revealed } from "./reveal"
import type { Span } from "./reveal"

type Field = readonly [string, string]

type Lookup = { kind: "found"; value: string } | { kind: "absent" }

class FrontmatterWidget extends WidgetType {
  constructor(private readonly fields: readonly Field[]) {
    super()
  }

  eq(other: FrontmatterWidget): boolean {
    return fieldsEqual(this.fields, other.fields)
  }

  toDOM(): HTMLElement {
    const strip = document.createElement("div")
    strip.className = "mb-fm-strip"

    const title = document.createElement("span")
    title.className = "mb-fm-title"
    title.textContent = titleText(this.fields)
    strip.appendChild(title)

    appendAuthor(strip, lookup(this.fields, "author"))

    return strip
  }

  ignoreEvent(): boolean {
    // A click on the strip should place the cursor inside the fence, which reveals
    // the raw YAML — so the event must reach CodeMirror, not be swallowed here.
    return false
  }
}

function appendAuthor(strip: HTMLElement, author: Lookup): void {
  switch (author.kind) {
    case "absent":
      return
    case "found": {
      const dot = document.createElement("span")
      dot.className = "mb-fm-dot"
      dot.textContent = "·"
      strip.appendChild(dot)

      const name = document.createElement("span")
      name.className = "mb-fm-author"
      name.textContent = author.value
      strip.appendChild(name)
      return
    }
  }
}

function titleText(fields: readonly Field[]): string {
  const title = lookup(fields, "title")

  switch (title.kind) {
    case "found":
      return title.value
    case "absent":
      return "Sem título"
  }
}

function lookup(fields: readonly Field[], key: string): Lookup {
  for (const [name, value] of fields) {
    switch (name === key) {
      case true:
        return { kind: "found", value }
      case false:
        break
    }
  }

  return { kind: "absent" }
}

function fieldsEqual(a: readonly Field[], b: readonly Field[]): boolean {
  switch (a.length === b.length) {
    case false:
      return false
    case true:
      return serialize(a) === serialize(b)
  }
}

function serialize(fields: readonly Field[]): string {
  return fields.map((field) => field[0] + ": " + field[1]).join("\n")
}

function build(state: EditorState): DecorationSet {
  const span = frontmatterSpan(state)

  switch (span.kind) {
    case "none":
      return Decoration.none
    case "some":
      return decorate(state, span)
  }
}

function decorate(state: EditorState, span: Extract<FrontmatterSpan, { kind: "some" }>): DecorationSet {
  const lineSpan: Span = { from: span.from, to: span.to }

  switch (revealed(selectionSpans(state), lineSpan)) {
    case false:
      return collapsed(span)
    case true:
      return expanded(state, span)
  }
}

function collapsed(span: Extract<FrontmatterSpan, { kind: "some" }>): DecorationSet {
  const widget = Decoration.replace({ widget: new FrontmatterWidget(span.fields), block: true })

  return Decoration.set(widget.range(span.from, span.to))
}

function expanded(state: EditorState, span: Extract<FrontmatterSpan, { kind: "some" }>): DecorationSet {
  const dim = Decoration.line({ class: "mb-fm" })
  const ranges = []

  for (let n = span.fromLine + 1; n <= span.toLine + 1; n++) {
    ranges.push(dim.range(state.doc.line(n).from))
  }

  return Decoration.set(ranges)
}

function selectionSpans(state: EditorState): readonly Span[] {
  return state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
}

const field = StateField.define<DecorationSet>({
  create(state) {
    return build(state)
  },
  update(value, tr) {
    switch (tr.docChanged || tr.selection !== undefined) {
      case true:
        return build(tr.state)
      case false:
        return value
    }
  },
  provide: (self) => EditorView.decorations.from(self),
})

export function frontmatterField(): Extension {
  return field
}
