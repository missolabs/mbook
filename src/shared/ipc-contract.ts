// The single source of truth for the IPC boundary: one zod schema per channel
// request and response, plus the main->renderer event payloads. Every handler
// (src/main/ipc/handlers.ts) parses its payload with the request schema before
// acting; every response is Result-shaped JSON, so a failure crosses the bridge
// as a value and never as a thrown exception. The preload bridge (window.mbook)
// and the renderer's DocSession are generated against the types derived here.
//
// zod and type-only imports only — this file runs in all three processes and
// must not touch electron or node.

import { z } from "zod"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const fileErrorSchema = z.object({
  kind: z.enum(["read-failed", "write-failed"]),
  path: z.string(),
  message: z.string(),
})

export type FileError = z.infer<typeof fileErrorSchema>

// A Result-shaped response: value on success, typed FileError on failure. Mirrors
// shared/result.ts on the wire so the renderer pattern-matches ok instead of
// catching.
function result<T extends z.ZodTypeAny>(value: T) {
  return z.union([
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: fileErrorSchema }),
  ])
}

// ---------------------------------------------------------------------------
// Channel map: request schema -> response schema (responses are Result-shaped)
// ---------------------------------------------------------------------------

export const channelRequest = {
  "book:bootstrap": z.object({}),
  "book:open": z.object({}),
  "book:open-path": z.object({ path: z.string() }),
  "book:save": z.object({ path: z.string(), content: z.string() }),
  "book:save-as": z.object({ content: z.string() }),
  "book:recent": z.object({}),
  "book:set-edited": z.object({ edited: z.boolean(), name: z.string() }),
  "menu:outline": z.object({ chapters: z.array(z.object({ title: z.string() })) }),
}

export const channelResponse = {
  // The most-recent entry, restored. A vanished or unreadable recorded file
  // degrades to "none" (a clean launch), never a startup error.
  "book:bootstrap": result(
    z.union([
      z.object({
        kind: z.literal("restored"),
        path: z.string(),
        content: z.string(),
      }),
      z.object({ kind: z.literal("none") }),
    ]),
  ),
  "book:open": result(
    z.union([
      z.object({
        kind: z.literal("opened"),
        path: z.string(),
        content: z.string(),
      }),
      z.object({ kind: z.literal("cancelled") }),
    ]),
  ),
  "book:open-path": result(z.object({ path: z.string(), content: z.string() })),
  "book:save": result(z.object({ savedAt: z.string() })),
  "book:save-as": result(
    z.union([
      z.object({ kind: z.literal("saved"), path: z.string() }),
      z.object({ kind: z.literal("cancelled") }),
    ]),
  ),
  "book:recent": result(
    z.object({ entries: z.array(z.object({ path: z.string() })) }),
  ),
  "book:set-edited": result(z.object({ acked: z.literal(true) })),
  "menu:outline": result(z.object({ acked: z.literal(true) })),
}

export type ChannelName = keyof typeof channelRequest

export type ChannelRequest<C extends ChannelName> = z.infer<
  (typeof channelRequest)[C]
>

export type ChannelResponse<C extends ChannelName> = z.infer<
  (typeof channelResponse)[C]
>

// ---------------------------------------------------------------------------
// Main -> renderer events (webContents.send)
// ---------------------------------------------------------------------------

export const eventPayload = {
  "evt:menu": z.discriminatedUnion("action", [
    z.object({ action: z.literal("new") }),
    z.object({ action: z.literal("open") }),
    z.object({ action: z.literal("save") }),
    z.object({ action: z.literal("save-as") }),
    z.object({ action: z.literal("open-path"), path: z.string() }),
    z.object({ action: z.literal("toggle-navigator") }),
    z.object({ action: z.literal("zoom-in") }),
    z.object({ action: z.literal("zoom-out") }),
    z.object({ action: z.literal("zoom-reset") }),
    z.object({ action: z.literal("go-title") }),
    z.object({ action: z.literal("go-chapter"), index: z.number() }),
  ]),
}

export type EventName = keyof typeof eventPayload

export type EventPayload<E extends EventName> = z.infer<
  (typeof eventPayload)[E]
>
