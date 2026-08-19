// DocSession owns the document lifecycle and nothing else: which file is open,
// whether it has unsaved edits, and every transition between those states —
// boot/restore, dirty tracking, debounced autosave, flush-on-blur, and the
// menu-driven open/save/save-as/new. It reaches the world only through the
// injected bridge, a status view, and get/set content functions over the editor,
// so it runs unchanged against in-memory fakes in a test.

import type { StatusState } from "./statusbar"

// The bridge type via the global augmentation (src/renderer/env.d.ts), so renderer
// sources never import the preload module — only the shared IPC types travel here.
type MbookBridge = Window["mbook"]

type DocState =
  | { kind: "untitled"; dirty: boolean }
  | { kind: "on-disk"; path: string; dirty: boolean }

type Timer = ReturnType<typeof setTimeout>

type Autosave = { kind: "idle" } | { kind: "scheduled"; timer: Timer }

type MenuAction = "new" | "open" | "save" | "save-as"

// The narrow slice of the statusbar DocSession drives — the file cell only. The
// counts cell is owned by the page tracker; the composing StatusModel merges the
// two halves so neither setter clobbers the other. A test passes a recording fake.
export type StatusView = { setFile: (file: StatusState["file"]) => void }

export type DocSessionDeps = {
  bridge: MbookBridge
  statusbar: StatusView
  getContent: () => string
  setContent: (text: string) => void
  debounceMs: number
}

// The empty-document seed: a frontmatter skeleton the writer fills in.
const STUB = "---\ntitle: \nauthor: \n---\n\n"

export class DocSession {
  private readonly deps: DocSessionDeps
  private state: DocState
  private autosave: Autosave

  constructor(deps: DocSessionDeps) {
    this.deps = deps
    this.state = { kind: "untitled", dirty: false }
    this.autosave = { kind: "idle" }
  }

  async boot(): Promise<void> {
    const result = await this.deps.bridge["book:bootstrap"]({})

    switch (result.ok) {
      case false:
        this.resetToStub()
        return
      case true: {
        const outcome = result.value

        switch (outcome.kind) {
          case "none":
            this.resetToStub()
            return
          case "restored":
            this.loadDisk(outcome.path, outcome.content)
            return
        }
      }
    }
  }

  onDocChanged(): void {
    this.ensureDirty()

    this.scheduleAutosave()
  }

  async flush(): Promise<void> {
    this.cancelAutosave()

    await this.saveIfPossible()
  }

  // Open a known path directly — File > Open Recent. Same discipline as
  // the dialog path: pending work is preserved before the switch, and the main
  // process records the path into the recent ledger.
  async openPathDoc(path: string): Promise<void> {
    await this.preserveBeforeSwitch()

    const result = await this.deps.bridge["book:open-path"]({ path })

    switch (result.ok) {
      case false:
        return
      case true:
        this.loadDisk(result.value.path, result.value.content)
        return
    }
  }

  async onMenu(action: MenuAction): Promise<void> {
    switch (action) {
      case "new":
        await this.newDoc()
        return
      case "open":
        await this.openDoc()
        return
      case "save":
        await this.saveDoc()
        return
      case "save-as":
        await this.saveAsDoc()
        return
    }
  }

  // -------------------------------------------------------------------------
  // Menu behaviors
  // -------------------------------------------------------------------------

  private async newDoc(): Promise<void> {
    await this.flush()

    this.resetToStub()
  }

  private async openDoc(): Promise<void> {
    await this.preserveBeforeSwitch()

    const result = await this.deps.bridge["book:open"]({})

    switch (result.ok) {
      case false:
        return
      case true: {
        const outcome = result.value

        switch (outcome.kind) {
          case "cancelled":
            return
          case "opened":
            this.loadDisk(outcome.path, outcome.content)
            return
        }
      }
    }
  }

  private async saveDoc(): Promise<void> {
    const state = this.state

    switch (state.kind) {
      case "untitled":
        await this.saveAsDoc()
        return
      case "on-disk":
        await this.saveTo(state.path)
        return
    }
  }

  private async saveAsDoc(): Promise<void> {
    const content = this.deps.getContent()

    const result = await this.deps.bridge["book:save-as"]({ content })

    switch (result.ok) {
      case false:
        return
      case true: {
        const outcome = result.value

        switch (outcome.kind) {
          case "cancelled":
            return
          case "saved":
            this.markSaved(outcome.path)
            return
        }
      }
    }
  }

  // A pending on-disk edit flushes; a dirty untitled buffer must not be lost to
  // the switch, so it forces an explicit save-as first.
  private async preserveBeforeSwitch(): Promise<void> {
    const state = this.state

    switch (state.kind) {
      case "on-disk":
        await this.flush()
        return
      case "untitled": {
        switch (state.dirty) {
          case false:
            return
          case true:
            await this.saveAsDoc()
            return
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Autosave
  // -------------------------------------------------------------------------

  private scheduleAutosave(): void {
    this.cancelAutosave()

    const timer = setTimeout(() => {
      this.autosave = { kind: "idle" }

      void this.saveIfPossible()
    }, this.deps.debounceMs)

    this.autosave = { kind: "scheduled", timer }
  }

  private cancelAutosave(): void {
    switch (this.autosave.kind) {
      case "idle":
        return
      case "scheduled":
        clearTimeout(this.autosave.timer)

        this.autosave = { kind: "idle" }
        return
    }
  }

  // An untitled buffer waits for an explicit save; only a dirty on-disk file
  // autosaves in place.
  private async saveIfPossible(): Promise<void> {
    const state = this.state

    switch (state.kind) {
      case "untitled":
        return
      case "on-disk": {
        switch (state.dirty) {
          case false:
            return
          case true:
            await this.saveTo(state.path)
            return
        }
      }
    }
  }

  private async saveTo(path: string): Promise<void> {
    const content = this.deps.getContent()

    const result = await this.deps.bridge["book:save"]({ path, content })

    switch (result.ok) {
      case false:
        // Leave the buffer dirty; the next edit or flush retries.
        return
      case true:
        this.markSaved(path)
        return
    }
  }

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  private resetToStub(): void {
    this.deps.setContent(STUB)

    this.apply({ kind: "untitled", dirty: false })
  }

  private loadDisk(path: string, content: string): void {
    this.deps.setContent(content)

    this.apply({ kind: "on-disk", path, dirty: false })
  }

  private markSaved(path: string): void {
    this.apply({ kind: "on-disk", path, dirty: false })
  }

  private ensureDirty(): void {
    switch (this.state.dirty) {
      case true:
        return
      case false:
        this.apply({ ...this.state, dirty: true })
        return
    }
  }

  private apply(state: DocState): void {
    this.state = state

    this.deps.statusbar.setFile(this.fileState())

    void this.deps.bridge["book:set-edited"]({
      edited: state.dirty,
      name: this.titleName(),
    })
  }

  private fileState(): StatusState["file"] {
    const state = this.state

    switch (state.kind) {
      case "untitled":
        return { kind: "untitled" }
      case "on-disk":
        return { kind: "named", name: basename(state.path), dirty: state.dirty }
    }
  }

  private titleName(): string {
    const state = this.state

    switch (state.kind) {
      case "untitled":
        return "untitled"
      case "on-disk":
        return basename(state.path)
    }
  }
}

function basename(path: string): string {
  const parts = path.split("/")

  const last = parts[parts.length - 1]

  switch (last) {
    case undefined:
      return path
    case "":
      return path
    default:
      return last
  }
}
