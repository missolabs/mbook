// The build scheduler: a save or open hands a book's path and content here,
// and — off the critical path — the driver compiles the book and the backend
// persists it, the way an IDE's background compilation never blocks typing.
// Three invariants shape it:
//   * a save must NEVER fail or slow because of analysis, so scheduling returns
//     at once and the work is deferred (setImmediate) with every failure logged
//     as a value, never thrown;
//   * an unchanged book is skipped (content sha256 matches the stored hash);
//   * runs are debounced per path — a newer schedule during an in-flight run
//     supersedes it, and stale intermediate content is dropped.
// The native driver is reached only through a dynamic import inside the guarded
// deferred task, so an ABI mismatch degrades to a logged no-op, never a boot
// crash.

import { createHash } from "node:crypto"
import { join } from "node:path"

import { app } from "electron"

import { analyzeBook } from "../../shared/lingua/driver"
import type { BookAnalysis, LexiconSource } from "../../shared/lingua/driver"
import { dictId } from "../../shared/lingua/language"
import type { Language } from "../../shared/lingua/language"
import type { Lexicon } from "../../shared/lingua/lexicon"
import type { Optional } from "../../shared/optional"
import type { Result } from "../../shared/result"

import { getLingua } from "../lingua-holder"
import type { Lingua } from "../lingua"
import type { DictLang } from "../lingua-paths"
import { analysisToRows } from "./lower"
import type { BookRecord, LinguaStore, StoreError } from "./store"

const latest = new Map<string, string>()
const running = new Set<string>()

// Fire-and-forget: record the newest content for this path and, unless a run is
// already draining it, kick one off on the next tick so the caller's save
// response is never delayed.
export function scheduleAnalysis(path: string, content: string): void {
  latest.set(path, content)

  switch (running.has(path)) {
    case true:
      return
    case false:
      break
  }

  running.add(path)

  setImmediate(() => {
    void drain(path)
  })
}

// Serial per path: run the newest queued content, and if a fresher schedule
// landed while running, loop to it; otherwise release the path.
async function drain(path: string): Promise<void> {
  while (true) {
    const content = latest.get(path)

    switch (content === undefined) {
      case true:
        running.delete(path)
        return
      case false:
        break
    }

    latest.delete(path)

    await runOnce(path, content!)

    switch (latest.has(path)) {
      case true:
        continue
      case false:
        running.delete(path)
        return
    }
  }
}

async function runOnce(path: string, content: string): Promise<void> {
  const hash = hashContent(content)

  const analysis = analyzeBook(content, currentSource())

  switch (analysis.ok) {
    case false:
      console.log(`[mbook] analysis skipped for ${path}: ${analysis.error.kind}`)
      return
    case true:
      break
  }

  const opened = await loadStore(dbPath())

  switch (opened.ok) {
    case false:
      console.warn(`[mbook] analysis store unavailable for ${path}: ${opened.error.kind} ${opened.error.message}`)
      return
    case true:
      break
  }

  persist(opened.value, path, hash, analysis.value)
}

function persist(
  store: LinguaStore,
  path: string,
  hash: string,
  analysis: BookAnalysis,
): void {
  try {
    const stored = store.storedHash(path)

    switch (unchanged(stored, hash)) {
      case true:
        console.log(`[mbook] analysis skip (unchanged) for ${path}`)
        return
      case false:
        break
    }

    const record: BookRecord = {
      path,
      language: analysis.language.kind,
      contentHash: hash,
      analyzedAt: new Date().toISOString(),
    }

    store.refresh(record, analysisToRows(analysis))

    console.log(
      `[mbook] analyzed ${path}: ${analysis.cast.characters.length} characters, ${sentenceCount(analysis)} sentences`,
    )
  } catch (caught) {
    console.warn(`[mbook] analysis write failed for ${path}:`, messageOf(caught))
  } finally {
    store.close()
  }
}

// Bind the pipeline to whatever the composition root has loaded: a book's
// language selects its dictionary, or none when the engine is off / that
// dictionary failed — analyzeBook then yields a typed lexicon-unavailable no-op.
function currentSource(): LexiconSource {
  const held = getLingua()

  return (language) => selectLexicon(held, language)
}

function selectLexicon(held: Optional<Lingua>, language: Language): Optional<Lexicon> {
  switch (held.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      break
  }

  const loaded = pick(held.value, dictId(language))

  switch (loaded.ok) {
    case false:
      return { kind: "none" }
    case true:
      return { kind: "some", value: loaded.value }
  }
}

function pick(lingua: Lingua, id: DictLang): Result<Lexicon, unknown> {
  switch (id) {
    case "pt-BR":
      return lingua.ptBR
    case "en":
      return lingua.en
  }
}

// Reaching the native driver through a dynamic import keeps a load failure (ABI
// mismatch, missing binary) a caught value on the deferred path, never a crash
// on the boot import chain.
async function loadStore(path: string): Promise<Result<LinguaStore, StoreError>> {
  try {
    const module = await import("./store")

    return module.openLinguaStore(path)
  } catch (caught) {
    return { ok: false, error: { kind: "open-failed", message: messageOf(caught) } }
  }
}

function dbPath(): string {
  return join(app.getPath("userData"), "lingua.db")
}

function unchanged(stored: Optional<string>, hash: string): boolean {
  switch (stored.kind) {
    case "none":
      return false
    case "some":
      return stored.value === hash
  }
}

function sentenceCount(analysis: BookAnalysis): number {
  return analysis.paragraphs.reduce((sum, slot) => sum + slot.analysis.sentences.length, 0)
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function messageOf(caught: unknown): string {
  switch (caught instanceof Error) {
    case true:
      return (caught as Error).message
    case false:
      return String(caught)
  }
}
