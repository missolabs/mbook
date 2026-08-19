// The filesystem edge for the linguistic engine: read a .dict off disk and hand
// its bytes to the pure reader, each failure — a missing file or a corrupt
// format — captured as a value. The rest of main stays exception-free, and a
// dictionary that will not load simply leaves that language's engine off.

import { readFile } from "node:fs/promises"

import { openLexicon } from "../shared/lingua/lexicon"
import type { Lexicon, LexiconError } from "../shared/lingua/lexicon"
import { err, ok } from "../shared/result"
import type { Result } from "../shared/result"
import { dictionaryPath } from "./lingua-paths"
import type { DictLang } from "./lingua-paths"

export type DictLoadError =
  | { kind: "read-failed"; path: string; message: string }
  | { kind: "parse-failed"; path: string; error: LexiconError }

// Both languages, loaded once at boot. A per-language Result so one broken
// dictionary never denies the other.
export type Lingua = {
  ptBR: Result<Lexicon, DictLoadError>
  en: Result<Lexicon, DictLoadError>
}

export async function loadLexicon(
  lang: DictLang,
): Promise<Result<Lexicon, DictLoadError>> {
  const path = dictionaryPath(lang)

  const bytes = await readDict(path)

  switch (bytes.ok) {
    case false:
      return bytes
    case true:
      break
  }

  const opened = openLexicon(bytes.value)

  switch (opened.ok) {
    case false:
      return err({ kind: "parse-failed", path, error: opened.error })
    case true:
      return ok(opened.value)
  }
}

export async function loadLingua(): Promise<Lingua> {
  const [ptBR, en] = await Promise.all([loadLexicon("pt-BR"), loadLexicon("en")])

  return { ptBR, en }
}

async function readDict(path: string): Promise<Result<Uint8Array, DictLoadError>> {
  try {
    const buffer = await readFile(path)

    return ok(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  } catch (caught) {
    return err({ kind: "read-failed", path, message: messageOf(caught) })
  }
}

// One line per language, so a boot log shows exactly which engines came up and
// why any did not.
export function logLingua(lingua: Lingua): void {
  logOne("pt-BR", lingua.ptBR)
  logOne("en", lingua.en)
}

function logOne(lang: DictLang, loaded: Result<Lexicon, DictLoadError>): void {
  switch (loaded.ok) {
    case true:
      console.log(
        `[mbook] lexicon ${lang} loaded: ${loaded.value.formCount} forms, ${loaded.value.entryCount} entries`,
      )
      return
    case false:
      console.warn(`[mbook] lexicon ${lang} unavailable:`, describe(loaded.error))
      return
  }
}

function describe(error: DictLoadError): string {
  switch (error.kind) {
    case "read-failed":
      return `read-failed ${error.path}: ${error.message}`
    case "parse-failed":
      return `parse-failed ${error.path}: ${error.error.kind}`
  }
}

function messageOf(caught: unknown): string {
  switch (caught instanceof Error) {
    case true:
      return (caught as Error).message
    case false:
      return String(caught)
  }
}
