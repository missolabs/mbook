// The sheet painter: an absolutely positioned layer behind the text that draws
// one A5 surface per page, using the measured positions of the page joints the
// flow carries (page-breaks.ts). A sheet runs from the previous joint's header
// zone to the next joint's folio zone — the margin zones belong inside the
// sheet, the gap between them is bare backdrop.
//
// Each joint also carries a fill element, stretched here so every sheet is at
// least a full 210mm tall — the empty tail a part-filled book page really has.
// The sheet rectangles are computed with the new fills already accounted for
// (positions below a grown fill shift by the cumulative growth), so surfaces
// and text never disagree, even for the one frame before CodeMirror re-reads
// the widget heights.
//
// Only rendered joints can be measured; regions outside CodeMirror's viewport
// resolve to one long surface, which is corrected on the next viewport measure
// before they scroll into view.

import { ViewPlugin } from "@codemirror/view"
import type { EditorView, ViewUpdate } from "@codemirror/view"

import { setPageJoints } from "./page-breaks"

type Segment = { top: number; height: number }

type Fill = { element: HTMLElement; px: number }

type Sheets = { left: number; width: number; segments: readonly Segment[]; fills: readonly Fill[] }

const MM_TO_PX = 96 / 25.4

const A5_HEIGHT_MM = 210

// Fills below this delta stay untouched: rounding noise must not ping-pong the
// resize observer.
const FILL_TOLERANCE_PX = 1

class PageLayerPlugin {
  private readonly layer: HTMLElement

  constructor(view: EditorView) {
    this.layer = document.createElement("div")
    this.layer.className = "mb-page-layer"

    view.scrollDOM.insertBefore(this.layer, view.scrollDOM.firstChild)

    view.requestMeasure(this.measurer())
  }

  update(update: ViewUpdate): void {
    const jointsArrived = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(setPageJoints)),
    )

    switch (update.docChanged || update.viewportChanged || update.geometryChanged || jointsArrived) {
      case true:
        update.view.requestMeasure(this.measurer())
        return
      case false:
        return
    }
  }

  destroy(): void {
    this.layer.remove()
  }

  private measurer(): { read: (view: EditorView) => Sheets; write: (sheets: Sheets) => void } {
    return {
      read: (view) => readSheets(view, this.layer),
      write: (sheets) => writeSheets(this.layer, sheets),
    }
  }
}

export const pageLayer = ViewPlugin.fromClass(PageLayerPlugin)

function zoomFactor(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--mb-zoom")

  const parsed = Number(raw)

  switch (Number.isFinite(parsed) && parsed > 0) {
    case true:
      return parsed
    case false:
      return 1
  }
}

function readSheets(view: EditorView, layer: HTMLElement): Sheets {
  const layerRect = layer.getBoundingClientRect()
  const contentRect = view.contentDOM.getBoundingClientRect()

  const pageHeight = A5_HEIGHT_MM * MM_TO_PX * zoomFactor()

  const joints = Array.from(view.contentDOM.querySelectorAll(".mb-page-joint"))

  const segments: Segment[] = []
  const fills: Fill[] = []

  let top = contentRect.top
  let shift = 0

  for (const joint of joints) {
    const fillElement = joint.querySelector(".mb-page-fill")
    const folio = joint.querySelector(".mb-folio-zone")
    const head = joint.querySelector(".mb-head-zone")

    if (!(fillElement instanceof HTMLElement) || folio === null) {
      continue
    }

    const currentFill = fillElement.getBoundingClientRect().height

    const rawBottom = folio.getBoundingClientRect().bottom + shift
    const rawHeight = rawBottom - top

    const nextFill = Math.max(0, currentFill + (pageHeight - rawHeight))
    const delta = nextFill - currentFill

    segments.push({ top: top - layerRect.top, height: rawHeight + delta })

    fills.push({ element: fillElement, px: nextFill })

    shift = shift + delta

    if (head !== null) {
      top = head.getBoundingClientRect().top + shift
    }
  }

  switch (segments.length === 0) {
    // No joints rendered (or none exist): the visible region is one surface.
    case true:
      segments.push({ top: contentRect.top - layerRect.top, height: contentRect.height })
      break
    case false:
      break
  }

  return { left: contentRect.left - layerRect.left, width: contentRect.width, segments, fills }
}

function writeSheets(layer: HTMLElement, sheets: Sheets): void {
  for (const fill of sheets.fills) {
    const current = fill.element.getBoundingClientRect().height

    switch (Math.abs(fill.px - current) > FILL_TOLERANCE_PX) {
      case true:
        fill.element.style.height = `${fill.px}px`
        break
      case false:
        break
    }
  }

  layer.textContent = ""

  for (const segment of sheets.segments) {
    const sheet = document.createElement("div")

    sheet.className = "mb-page-sheet"
    sheet.style.left = `${sheets.left}px`
    sheet.style.width = `${sheets.width}px`
    sheet.style.top = `${segment.top}px`
    sheet.style.height = `${segment.height}px`

    layer.appendChild(sheet)
  }
}
