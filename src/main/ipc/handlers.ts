// Handler registry: one ipcMain.handle per channel. Every handler zod-parses its
// payload with channelRequest[channel] before acting; a parse failure becomes a
// Result error rather than a throw across the bridge. The HandlerTable is keyed
// by ChannelName, so adding a channel to the contract without a handler is a
// compile error. This is the whole filesystem-facing surface of the app: dialogs,
// reads/writes, the recent ledger, and the native title/edited/proxy sync.

import { BrowserWindow, dialog, ipcMain } from "electron"

import { channelRequest } from "../../shared/ipc-contract"
import type {
  ChannelName,
  ChannelRequest,
  ChannelResponse,
} from "../../shared/ipc-contract"
import type { Optional } from "../../shared/optional"
import { err, ok } from "../../shared/result"

import { readBookFile, writeBookFile } from "../files"
import { scheduleAnalysis } from "../lingua/analyzer"
import { setOutline, setRecents } from "../menu"
import { mostRecent, recentEntries, recordRecent } from "../recent"

const MD_FILTER = { name: "Markdown", extensions: ["md"] }

type Picked = { kind: "cancelled" } | { kind: "picked"; path: string }

type HandlerTable = {
  [C in ChannelName]: (request: ChannelRequest<C>) => Promise<ChannelResponse<C>>
}

const handlers: HandlerTable = {
  "book:bootstrap": () => bootstrap(),
  "book:open": () => open(),
  "book:open-path": (request) => openPath(request.path),
  "book:save": (request) => save(request.path, request.content),
  "book:save-as": (request) => saveAs(request.content),
  "book:recent": () => recent(),
  "book:set-edited": (request) => setEdited(request.edited, request.name),
  "menu:outline": (request) => outline(request.chapters),
}

export function registerIpcHandlers(): void {
  const channels = Object.keys(channelRequest) as ChannelName[]

  for (const channel of channels) {
    ipcMain.handle(channel, (_event, payload: unknown) =>
      dispatch(channel, payload),
    )
  }
}

function dispatch(channel: ChannelName, payload: unknown): Promise<unknown> {
  const parsed = channelRequest[channel].safeParse(payload)

  switch (parsed.success) {
    case false:
      // The renderer generates every payload from this same contract, so a parse
      // failure is a programming fault, not user input; surface it as a value.
      return Promise.resolve(
        err({ kind: "read-failed", path: channel, message: parsed.error.message }),
      )
    case true: {
      const handler = handlers[channel] as (
        request: unknown,
      ) => Promise<unknown>

      return handler(parsed.data)
    }
  }
}

// ---------------------------------------------------------------------------
// Channel behaviors
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<ChannelResponse<"book:bootstrap">> {
  const recentPath = await mostRecent()

  switch (recentPath.kind) {
    case "none":
      return ok({ kind: "none" })
    case "some": {
      const read = await readBookFile(recentPath.value)

      switch (read.ok) {
        case false:
          // A recorded file that vanished or turned unreadable is a clean
          // "none" launch, not an error the user must dismiss.
          return ok({ kind: "none" })
        case true:
          scheduleAnalysis(recentPath.value, read.value)

          return ok({
            kind: "restored",
            path: recentPath.value,
            content: read.value,
          })
      }
    }
  }
}

async function open(): Promise<ChannelResponse<"book:open">> {
  const picked = await showOpen()

  switch (picked.kind) {
    case "cancelled":
      return ok({ kind: "cancelled" })
    case "picked": {
      const read = await readBookFile(picked.path)

      switch (read.ok) {
        case false:
          return read
        case true:
          await recordRecent(picked.path)

          await refreshRecentMenu()

          representFile(picked.path)

          scheduleAnalysis(picked.path, read.value)

          return ok({ kind: "opened", path: picked.path, content: read.value })
      }
    }
  }
}

async function openPath(path: string): Promise<ChannelResponse<"book:open-path">> {
  const read = await readBookFile(path)

  switch (read.ok) {
    case false:
      return read
    case true:
      await recordRecent(path)

      await refreshRecentMenu()

      representFile(path)

      scheduleAnalysis(path, read.value)

      return ok({ path, content: read.value })
  }
}

async function save(
  path: string,
  content: string,
): Promise<ChannelResponse<"book:save">> {
  const written = await writeBookFile(path, content)

  switch (written.ok) {
    case false:
      return written
    case true:
      representFile(path)

      scheduleAnalysis(path, content)

      return ok({ savedAt: new Date().toISOString() })
  }
}

async function saveAs(content: string): Promise<ChannelResponse<"book:save-as">> {
  const picked = await showSave()

  switch (picked.kind) {
    case "cancelled":
      return ok({ kind: "cancelled" })
    case "picked": {
      const written = await writeBookFile(picked.path, content)

      switch (written.ok) {
        case false:
          return written
        case true:
          await recordRecent(picked.path)

          await refreshRecentMenu()

          representFile(picked.path)

          scheduleAnalysis(picked.path, content)

          return ok({ kind: "saved", path: picked.path })
      }
    }
  }
}

async function recent(): Promise<ChannelResponse<"book:recent">> {
  const entries = await recentEntries()

  return ok({ entries })
}

async function setEdited(
  edited: boolean,
  name: string,
): Promise<ChannelResponse<"book:set-edited">> {
  const window = firstWindow()

  switch (window.kind) {
    case "none":
      return ok({ acked: true })
    case "some":
      window.value.setDocumentEdited(edited)

      window.value.setTitle(name)

      return ok({ acked: true })
  }
}

// ---------------------------------------------------------------------------
// Dialogs and window plumbing
// ---------------------------------------------------------------------------

async function showOpen(): Promise<Picked> {
  const result = await dialog.showOpenDialog({
    filters: [MD_FILTER],
    properties: ["openFile"],
  })

  const path = result.filePaths[0]

  switch (path) {
    case undefined:
      return { kind: "cancelled" }
    default:
      return { kind: "picked", path }
  }
}

async function showSave(): Promise<Picked> {
  const result = await dialog.showSaveDialog({
    filters: [MD_FILTER],
    defaultPath: "untitled.md",
  })

  switch (result.canceled) {
    case true:
      return { kind: "cancelled" }
    case false:
      return { kind: "picked", path: result.filePath }
  }
}

// The proxy-icon file the title bar represents. On save/open paths the window
// adopts the on-disk file so the title's document proxy tracks it.
function representFile(path: string): void {
  const window = firstWindow()

  switch (window.kind) {
    case "none":
      return
    case "some":
      window.value.setRepresentedFilename(path)
      return
  }
}

function firstWindow(): Optional<BrowserWindow> {
  const window = BrowserWindow.getAllWindows()[0]

  switch (window) {
    case undefined:
      return { kind: "none" }
    default:
      return { kind: "some", value: window }
  }
}

// The renderer streams the live chapter outline up; the Go menu mirrors it.
async function outline(
  chapters: readonly { title: string }[],
): Promise<ChannelResponse<"menu:outline">> {
  setOutline(chapters.map((chapter) => chapter.title))

  return { ok: true, value: { acked: true } }
}

// File > Open Recent mirrors the ledger after every write to it — and once at
// registration, so a fresh launch starts with the list populated.
async function refreshRecentMenu(): Promise<void> {
  const entries = await recentEntries()

  setRecents(entries.map((entry) => entry.path))
}

export function primeMenuState(): void {
  void refreshRecentMenu()
}
