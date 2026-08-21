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
  // The compiler's open questions for this book — gold when any remain (R1:
  // an unread-class life signal).
  notes: number
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

    this.right.textContent = ""

    switch (state.notes > 0) {
      case true: {
        const count = document.createElement("span")
        count.className = "mb-notes-count"
        count.textContent = String(state.notes)
        this.right.appendChild(count)
        this.right.appendChild(document.createTextNode(" notas · "))
        break
      }
      case false:
        break
    }

    this.right.appendChild(document.createTextNode(`${countsText(state.counts)} · ${zoomText(state.zoom)}`))
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
