// The command bar: one in-app overlay — never a native window — dressed as an
// mdesign overlay exactly like the completion popup: the overlay panel, a
// single hairline (R4), square corners (R5), the small UI sans, and gold only
// on the one alive row (R1). This class owns presentation and keys alone:
// commands arrive already built by the composition root, ranking belongs to
// filter.ts, and running is each command's own closure. The instance is built
// once and reused; open() replaces the command set, extend() appends late
// arrivals (the recents fetch) under whatever the query already is.

import { rankCommands } from "./filter"
import type { Command } from "./filter"

export type PaletteDeps = {
  host: HTMLElement
  onClose: () => void
}

export class CommandPalette {
  private readonly deps: PaletteDeps
  private readonly backdrop: HTMLElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLElement
  private commands: readonly Command[]
  private shown: readonly Command[]
  private selected: number
  private visible: boolean

  constructor(deps: PaletteDeps) {
    this.deps = deps
    this.commands = []
    this.shown = []
    this.selected = 0
    this.visible = false

    this.backdrop = document.createElement("div")
    this.backdrop.className = "mb-cmd-backdrop"

    const panel = document.createElement("div")
    panel.className = "mb-cmd-panel"

    this.input = document.createElement("input")
    this.input.className = "mb-cmd-input"
    this.input.placeholder = "comando…"
    this.input.spellcheck = false

    this.list = document.createElement("div")
    this.list.className = "mb-cmd-list"

    panel.append(this.input, this.list)
    this.backdrop.append(panel)
    this.backdrop.style.display = "none"
    deps.host.append(this.backdrop)

    this.backdrop.addEventListener("mousedown", (event) => {
      switch (event.target === this.backdrop) {
        case true:
          this.close()
          return
        case false:
          return
      }
    })

    this.input.addEventListener("input", () => {
      this.selected = 0
      this.render()
    })

    this.input.addEventListener("keydown", (event) => this.onKey(event))
  }

  isOpen(): boolean {
    return this.visible
  }

  open(commands: readonly Command[]): void {
    this.commands = commands
    this.visible = true
    this.selected = 0
    this.input.value = ""
    this.backdrop.style.display = ""
    this.render()
    this.input.focus()
  }

  // Late-arriving commands (an async fetch) join the current set and re-rank
  // under the query the writer has already typed.
  extend(more: readonly Command[]): void {
    switch (this.visible) {
      case false:
        return
      case true:
        break
    }

    this.commands = [...this.commands, ...more]
    this.render()
  }

  close(): void {
    switch (this.visible) {
      case false:
        return
      case true:
        break
    }

    this.visible = false
    this.backdrop.style.display = "none"
    this.deps.onClose()
  }

  private onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        this.move(1)
        return
      case "ArrowUp":
        event.preventDefault()
        this.move(-1)
        return
      case "Enter": {
        event.preventDefault()

        const chosen = this.shown[this.selected]

        switch (chosen === undefined) {
          case true:
            return
          case false:
            this.execute(chosen!)
            return
        }
      }
      case "Escape":
        event.preventDefault()
        this.close()
        return
      default:
        return
    }
  }

  private move(delta: number): void {
    switch (this.shown.length === 0) {
      case true:
        return
      case false:
        break
    }

    const next = this.selected + delta
    const wrapped = (next + this.shown.length) % this.shown.length

    this.selected = wrapped
    this.paintSelection()
  }

  // Close BEFORE running: the command may move focus (navigation focuses the
  // editor) and the close-time focus handoff must not fight it.
  private execute(command: Command): void {
    this.close()
    command.run()
  }

  private render(): void {
    this.shown = rankCommands(this.commands, this.input.value)

    switch (this.selected >= this.shown.length) {
      case true:
        this.selected = 0
        break
      case false:
        break
    }

    this.list.replaceChildren()

    let lastGroup = ""

    this.shown.forEach((command, index) => {
      switch (command.group === lastGroup) {
        case false: {
          lastGroup = command.group

          const header = document.createElement("div")
          header.className = "mb-cmd-group"
          header.textContent = command.group
          this.list.append(header)
          break
        }
        case true:
          break
      }

      const row = document.createElement("div")
      row.className = "mb-cmd-row"
      row.dataset.index = String(index)

      const title = document.createElement("span")
      title.className = "mb-cmd-title"
      title.textContent = command.title

      const hint = document.createElement("span")
      hint.className = "mb-cmd-hint"
      hint.textContent = command.hint

      row.append(title, hint)

      row.addEventListener("mousedown", (event) => {
        event.preventDefault()
        this.execute(command)
      })

      this.list.append(row)
    })

    this.paintSelection()
  }

  private paintSelection(): void {
    const rows = this.list.querySelectorAll<HTMLElement>(".mb-cmd-row")

    rows.forEach((row) => {
      const active = row.dataset.index === String(this.selected)

      row.classList.toggle("selected", active)

      switch (active) {
        case true:
          row.scrollIntoView({ block: "nearest" })
          return
        case false:
          return
      }
    })
  }
}
