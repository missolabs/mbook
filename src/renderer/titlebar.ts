// The titlebar strip's sole job: name the open book. It consumes the same file
// half of the status state that the status band renders, so the two can never
// disagree; the doc-title node is injected to keep it testable without a window.

import type { StatusState } from "./statusbar"

export class Titlebar {
  private readonly docTitle: HTMLElement

  constructor(docTitle: HTMLElement) {
    this.docTitle = docTitle
  }

  setFile(file: StatusState["file"]): void {
    this.docTitle.textContent = titleText(file)
  }
}

function titleText(file: StatusState["file"]): string {
  switch (file.kind) {
    case "untitled":
      return "untitled"
    case "named":
      return bookName(file.name) + dirtyMark(file.dirty)
  }
}

function bookName(name: string): string {
  switch (name.endsWith(".md")) {
    case true:
      return name.slice(0, -".md".length)
    case false:
      return name
  }
}

function dirtyMark(dirty: boolean): string {
  switch (dirty) {
    case true:
      return " •"
    case false:
      return ""
  }
}
