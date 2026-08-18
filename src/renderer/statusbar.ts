// The status band's sole job: turn a StatusState into the two text ends of the
// bottom chrome. It owns no layout and no DOM creation — the left/right spans are
// injected so the class stays a pure text-writer and is testable without a window.

export type StatusState = {
  file:
    | { kind: "untitled" }
    | { kind: "named"; name: string; dirty: boolean }
  counts:
    | { kind: "empty" }
    | { kind: "counted"; page: number; totalPages: number; words: number }
  zoom: number
}

const EM_DASH = "—"

export class Statusbar {
  private readonly left: HTMLElement
  private readonly right: HTMLElement

  constructor(left: HTMLElement, right: HTMLElement) {
    this.left = left
    this.right = right
  }

  render(state: StatusState): void {
    this.left.textContent = fileText(state.file)

    this.right.textContent = `${countsText(state.counts)} · ${zoomText(state.zoom)}`
  }
}

function zoomText(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

function fileText(file: StatusState["file"]): string {
  switch (file.kind) {
    case "untitled":
      return EM_DASH
    case "named":
      return dirtyMark(file.dirty) + file.name
  }
}

function dirtyMark(dirty: boolean): string {
  switch (dirty) {
    case true:
      return "• "
    case false:
      return ""
  }
}

function countsText(counts: StatusState["counts"]): string {
  switch (counts.kind) {
    case "empty":
      return EM_DASH
    case "counted":
      return `${counts.page}/${counts.totalPages} · ${counts.words.toLocaleString("pt-BR")} palavras`
  }
}
