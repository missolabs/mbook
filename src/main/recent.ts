// The recent-files ledger: recent.json in userData, most-recent first. This is
// the memory behind restore-on-launch (mostRecent) and the recent list
// (recentEntries). Reads parse-don't-validate — a missing or corrupt file yields
// the empty default, never a throw. Writes are best-effort: recent tracking must
// never sink the open or save it decorates.

import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { app } from "electron"
import { z } from "zod"

import type { Optional } from "../shared/optional"

const CAP = 10

const recentSchema = z.object({
  entries: z.array(z.object({ path: z.string(), openedAt: z.string() })),
})

type RecentStore = z.infer<typeof recentSchema>

const EMPTY: RecentStore = { entries: [] }

export async function recordRecent(path: string): Promise<void> {
  const store = await loadStore()

  const openedAt = new Date().toISOString()

  const withoutPath = store.entries.filter((entry) => entry.path !== path)

  const next: RecentStore = {
    entries: [{ path, openedAt }, ...withoutPath].slice(0, CAP),
  }

  await writeStore(next)
}

export async function mostRecent(): Promise<Optional<string>> {
  const store = await loadStore()

  const first = store.entries[0]

  switch (first) {
    case undefined:
      return { kind: "none" }
    default:
      return { kind: "some", value: first.path }
  }
}

export async function recentEntries(): Promise<{ path: string }[]> {
  const store = await loadStore()

  return store.entries.map((entry) => ({ path: entry.path }))
}

function recentPath(): string {
  return join(app.getPath("userData"), "recent.json")
}

async function loadStore(): Promise<RecentStore> {
  const raw = await readRaw(recentPath())

  switch (raw.kind) {
    case "none":
      return EMPTY
    case "some":
      return parseStore(raw.value)
  }
}

function parseStore(text: string): RecentStore {
  const json = safeJson(text)

  switch (json.kind) {
    case "none":
      return EMPTY
    case "some": {
      const parsed = recentSchema.safeParse(json.value)

      switch (parsed.success) {
        case false:
          return EMPTY
        case true:
          return parsed.data
      }
    }
  }
}

async function readRaw(path: string): Promise<Optional<string>> {
  try {
    const text = await readFile(path, "utf8")

    return { kind: "some", value: text }
  } catch {
    return { kind: "none" }
  }
}

function safeJson(text: string): Optional<unknown> {
  try {
    return { kind: "some", value: JSON.parse(text) }
  } catch {
    return { kind: "none" }
  }
}

async function writeStore(store: RecentStore): Promise<void> {
  try {
    await writeFile(recentPath(), JSON.stringify(store, null, 2), "utf8")
  } catch {
    // Ledger persistence is best-effort; a failed write must not fail the
    // open/save that triggered it.
  }
}
