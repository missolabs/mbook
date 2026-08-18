// Window geometry persistence. First launch opens at a fraction of the current
// display's work area (so a large display opens large); later launches restore
// the saved frame, clamped to a currently-visible display so a window saved on an
// unplugged monitor never opens offscreen. Losing the geometry must never fail a
// resize or a close, so the write hands its failure back as a value.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { app, screen } from "electron"
import type { BrowserWindow, Rectangle } from "electron"

import { assertNever } from "../shared/assert"
import { err, ok } from "../shared/result"
import type { Result } from "../shared/result"
import type { Ack, Optional } from "../shared/optional"

const MIN_WIDTH = 720
const MIN_HEIGHT = 480
const DEFAULT_FRACTION = 0.82
const SAVE_DEBOUNCE_MS = 400

type SaveError = { kind: "io-error"; message: string }

// What the persisted geometry resolved to: a saved frame to restore, or nothing
// saved yet. window.ts turns each case into concrete opening bounds. A union,
// not a nullable Rectangle, so no reader downstream has to re-guess `null`.
export type WindowStateLoad =
  | { kind: "restored"; bounds: Rectangle }
  | { kind: "default" }

export function loadWindowState(): WindowStateLoad {
  const raw = readJson()

  switch (raw.kind) {
    case "none":
      return { kind: "default" }
    case "some":
      return parseLoad(raw.value)
  }
}

// The concrete opening frame for each load case: a restored frame is snapped back
// onto a visible display; a first launch centers a fraction of the work area.
export function boundsFor(load: WindowStateLoad): Rectangle {
  switch (load.kind) {
    case "restored":
      return visibleBounds(load.bounds)
    case "default":
      return defaultBounds()
    default:
      return assertNever(load)
  }
}

// Persist every resize/move, and once more on close.
export function trackWindowState(window: BrowserWindow): void {
  const save = debounce(() => saveState(window), SAVE_DEBOUNCE_MS)

  window.on("resize", save)
  window.on("move", save)
  window.on("close", () => saveState(window))
}

// The failure is discarded on purpose — geometry is not worth aborting a close
// over — but discarded out loud, not swallowed by a bare catch.
function saveState(window: BrowserWindow): void {
  switch (window.isDestroyed()) {
    case true:
      return
    case false:
      break
  }

  const saved = persist(window.getBounds())

  switch (saved.ok) {
    case true:
      return
    case false:
      console.warn(`[mbook] window state not saved — ${saved.error.message}`)
      return
  }
}

function parseLoad(value: unknown): WindowStateLoad {
  const rect = parseBounds(value)

  switch (rect.kind) {
    case "none":
      return { kind: "default" }
    case "some":
      return { kind: "restored", bounds: rect.value }
  }
}

function defaultBounds(): Rectangle {
  const work = screen.getPrimaryDisplay().workArea

  const width = clamp(Math.round(work.width * DEFAULT_FRACTION), MIN_WIDTH, work.width)
  const height = clamp(Math.round(work.height * DEFAULT_FRACTION), MIN_HEIGHT, work.height)

  const x = work.x + Math.round((work.width - width) / 2)
  const y = work.y + Math.round((work.height - height) / 2)

  return { x, y, width, height }
}

// Snap a restored rect back onto whichever connected display it best matches,
// clamping size to that display's work area and nudging the origin so the whole
// window is on-screen — the saved-on-an-unplugged-monitor case.
function visibleBounds(rect: Rectangle): Rectangle {
  const work = screen.getDisplayMatching(rect).workArea

  const width = clamp(rect.width, MIN_WIDTH, work.width)
  const height = clamp(rect.height, MIN_HEIGHT, work.height)

  const x = clamp(rect.x, work.x, work.x + work.width - width)
  const y = clamp(rect.y, work.y, work.y + work.height - height)

  return { x, y, width, height }
}

// The one place raw JSON is inspected: unstructured value in, a precise Rectangle
// out. Everything downstream trusts the result and never re-checks.
function parseBounds(value: unknown): Optional<Rectangle> {
  const record = asRecord(value)

  switch (record.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      break
  }

  const rect = record.value

  const nums = [rect["x"], rect["y"], rect["width"], rect["height"]].every(
    (n) => typeof n === "number" && Number.isFinite(n),
  )

  switch (nums) {
    case false:
      return { kind: "none" }
    case true:
      return {
        kind: "some",
        value: {
          x: rect["x"] as number,
          y: rect["y"] as number,
          width: rect["width"] as number,
          height: rect["height"] as number,
        },
      }
  }
}

function asRecord(value: unknown): Optional<Record<string, unknown>> {
  switch (typeof value === "object" && value !== null) {
    case false:
      return { kind: "none" }
    case true:
      return { kind: "some", value: value as Record<string, unknown> }
  }
}

function readJson(): Optional<unknown> {
  try {
    return { kind: "some", value: JSON.parse(readFileSync(statePath(), "utf8")) }
  } catch {
    return { kind: "none" }
  }
}

function persist(bounds: Rectangle): Result<Ack, SaveError> {
  try {
    writeFileSync(statePath(), JSON.stringify(bounds))

    return ok({ kind: "ok" })
  } catch (caught) {
    return err({ kind: "io-error", message: String(caught) })
  }
}

function statePath(): string {
  return join(app.getPath("userData"), "window-state.json")
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: Optional<ReturnType<typeof setTimeout>> = { kind: "none" }

  return () => {
    switch (timer.kind) {
      case "none":
        break
      case "some":
        clearTimeout(timer.value)
        break
    }

    timer = { kind: "some", value: setTimeout(fn, ms) }
  }
}
