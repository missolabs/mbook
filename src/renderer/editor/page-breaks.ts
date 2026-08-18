// Page joints: where the A5 estimate turns a page, the document flow carries a
// block widget that ends one sheet and opens the next — the closing sheet's
// bottom margin with its folio (page number), a small gap of bare backdrop,
// then the opening sheet's top margin with its running chapter header. A final
// joint at the document end closes the last sheet. The sheet surfaces
// themselves are painted behind the text by page-layer.ts, which reads the
// joints' measured positions.
//
// The pagination fold lives outside the editor and its recompute is debounced,
// so joints arrive by effect; between effects the field maps its decorations
// through document changes.

import { StateEffect, StateField } from "@codemirror/state"
import type { EditorState, Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"

// One joint: the zero-based line that begins a sheet, the folio of the sheet
// ending here, and the running header of the sheet starting here ("" = none —
// chapter-opening pages carry no header, in the classic manner).
export type PageJoint = { line: number; folio: number; header: string }

export type PageJoints = { joints: readonly PageJoint[]; lastFolio: number }

export const setPageJoints = StateEffect.define<PageJoints>()

// The half-title (page 1) is unnumbered, so a folio of 1 never renders.
const UNNUMBERED = 1

class JointWidget extends WidgetType {
  private readonly folio: number
  private readonly header: string
  private readonly kind: "mid" | "end"

  constructor(folio: number, header: string, kind: "mid" | "end") {
    super()

    this.folio = folio
    this.header = header
    this.kind = kind
  }

  override eq(other: JointWidget): boolean {
    return this.folio === other.folio && this.header === other.header && this.kind === other.kind
  }

  override toDOM(): HTMLElement {
    const root = document.createElement("div")
    root.className = "mb-page-joint"

    // The fill is stretched by page-layer.ts to pad the closing sheet to a full
    // 210mm — the empty tail a part-filled book page really has.
    const fill = document.createElement("div")
    fill.className = "mb-page-fill"
    root.appendChild(fill)

    root.appendChild(this.folioZone())

    switch (this.kind) {
      case "end":
        return root
      case "mid":
        break
    }

    const gap = document.createElement("div")
    gap.className = "mb-page-gap"
    root.appendChild(gap)

    const head = document.createElement("div")
    head.className = "mb-head-zone"
    head.textContent = this.header
    root.appendChild(head)

    return root
  }

  override get estimatedHeight(): number {
    switch (this.kind) {
      case "mid":
        return 238
      case "end":
        return 83
    }
  }

  private folioZone(): HTMLElement {
    const zone = document.createElement("div")
    zone.className = "mb-folio-zone"

    switch (this.folio === UNNUMBERED) {
      case true:
        break
      case false:
        zone.textContent = String(this.folio)
        break
    }

    return zone
  }
}

export const pageJointsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,

  update: (joints, tr) => nextJoints(joints, tr),

  provide: (field) => EditorView.decorations.from(field),
})

function nextJoints(joints: DecorationSet, tr: Transaction): DecorationSet {
  const mapped = joints.map(tr.changes)

  const effect = tr.effects.find((candidate) => candidate.is(setPageJoints))

  switch (effect) {
    case undefined:
      return mapped
    default:
      return decorationsFor(tr.state, effect.value)
  }
}

function decorationsFor(state: EditorState, value: PageJoints): DecorationSet {
  const inRange = value.joints.filter((joint) => joint.line > 0 && joint.line < state.doc.lines)

  const mids = inRange.map((joint) =>
    Decoration.widget({
      widget: new JointWidget(joint.folio, joint.header, "mid"),
      side: -1,
      block: true,
    }).range(state.doc.line(joint.line + 1).from),
  )

  const end = Decoration.widget({
    widget: new JointWidget(value.lastFolio, "", "end"),
    side: 1,
    block: true,
  }).range(state.doc.length)

  return Decoration.set([...mids, end], true)
}
