import { describe, expect, it } from "bun:test"

import { DocSession } from "../../src/renderer/doc-session"
import type { MbookBridge } from "../../src/preload/index"
import type { StatusState } from "../../src/renderer/statusbar"
import type { ChannelResponse } from "../../src/shared/ipc-contract"

// The stub DocSession seeds an empty buffer with — kept in sync with the source.
const STUB = "---\ntitle: \nauthor: \n---\n\n"

type Recorder = {
  files: StatusState["file"][]
  setEdited: { edited: boolean; name: string }[]
  saves: { path: string; content: string }[]
  saveAsCalls: number
}

// A fully in-memory bridge: every channel returns a real Result value, and the
// two branchy outcomes (what bootstrap restores, what save-as resolves to) are
// injected per test. Save and set-edited record their calls so transitions can be
// asserted through the same seam the renderer uses.
function makeSession(config: {
  bootstrap: ChannelResponse<"book:bootstrap">
  saveAs: ChannelResponse<"book:save-as">
}) {
  const rec: Recorder = { files: [], setEdited: [], saves: [], saveAsCalls: 0 }

  let content = ""

  const setContent = (text: string) => {
    content = text
  }

  const bridge: MbookBridge = {
    "book:bootstrap": async () => config.bootstrap,
    "book:open": async () => ({ ok: true, value: { kind: "cancelled" } }),
    "book:open-path": async ({ path }) => ({ ok: true, value: { path, content: "" } }),
    "book:save": async ({ path, content: body }) => {
      rec.saves.push({ path, content: body })

      return { ok: true, value: { savedAt: "t0" } }
    },
    "book:save-as": async () => {
      rec.saveAsCalls += 1

      return config.saveAs
    },
    "book:recent": async () => ({ ok: true, value: { entries: [] } }),
    "book:set-edited": async ({ edited, name }) => {
      rec.setEdited.push({ edited, name })

      return { ok: true, value: { acked: true } }
    },
    on: () => () => {},
  }

  const statusbar = {
    setFile: (file: StatusState["file"]) => {
      rec.files.push(file)
    },
  }

  const session = new DocSession({
    bridge,
    statusbar,
    getContent: () => content,
    setContent,
    debounceMs: 1,
  })

  return { session, rec, setContent, content: () => content }
}

function lastFile(rec: Recorder): StatusState["file"] {
  const last = rec.files[rec.files.length - 1]

  switch (last) {
    case undefined:
      throw new Error("no file rendered")
    default:
      return last
  }
}

describe("DocSession", () => {
  it("restores the recorded file on boot as a clean named document", async () => {
    const { session, rec, content } = makeSession({
      bootstrap: {
        ok: true,
        value: { kind: "restored", path: "/books/dune.md", content: "restored body" },
      },
      saveAs: { ok: true, value: { kind: "cancelled" } },
    })

    await session.boot()

    expect(content()).toBe("restored body")

    expect(lastFile(rec)).toEqual({ kind: "named", name: "dune.md", dirty: false })
  })

  it("opens a known path directly and flushes pending work first — File > Open Recent", async () => {
    const { session, rec } = makeSession({
      bootstrap: {
        ok: true,
        value: { kind: "restored", path: "/books/dune.md", content: "body" },
      },
      saveAs: { ok: true, value: { kind: "cancelled" } },
    })

    await session.boot()

    session.onDocChanged()

    await session.openPathDoc("/books/poco.md")

    // The dirty dune buffer was preserved by a save before the switch, and the
    // requested path is now the clean open document.
    expect(rec.saves.map((s) => s.path)).toEqual(["/books/dune.md"])
    expect(lastFile(rec)).toEqual({ kind: "named", name: "poco.md", dirty: false })
  })

  it("marks dirty on edit, then autosaves an on-disk file back to clean", async () => {
    const { session, rec, setContent } = makeSession({
      bootstrap: {
        ok: true,
        value: { kind: "restored", path: "/books/dune.md", content: "body" },
      },
      saveAs: { ok: true, value: { kind: "cancelled" } },
    })

    await session.boot()

    setContent("edited body")

    session.onDocChanged()

    expect(lastFile(rec)).toEqual({ kind: "named", name: "dune.md", dirty: true })

    await Bun.sleep(20)

    expect(rec.saves).toEqual([{ path: "/books/dune.md", content: "edited body" }])

    expect(lastFile(rec)).toEqual({ kind: "named", name: "dune.md", dirty: false })

    expect(rec.setEdited[rec.setEdited.length - 1]).toEqual({
      edited: false,
      name: "dune.md",
    })
  })

  it("routes Save on an untitled buffer to save-as, never a blind save", async () => {
    const { session, rec } = makeSession({
      bootstrap: { ok: true, value: { kind: "none" } },
      saveAs: { ok: true, value: { kind: "saved", path: "/books/new.md" } },
    })

    await session.boot()

    await session.onMenu("save")

    expect(rec.saveAsCalls).toBe(1)

    expect(rec.saves).toEqual([])

    expect(lastFile(rec)).toEqual({ kind: "named", name: "new.md", dirty: false })
  })

  it("resets to the frontmatter stub as an untitled document on New", async () => {
    const { session, rec, content } = makeSession({
      bootstrap: {
        ok: true,
        value: { kind: "restored", path: "/books/dune.md", content: "body" },
      },
      saveAs: { ok: true, value: { kind: "cancelled" } },
    })

    await session.boot()

    await session.onMenu("new")

    expect(content()).toBe(STUB)

    expect(lastFile(rec)).toEqual({ kind: "untitled" })
  })
})
