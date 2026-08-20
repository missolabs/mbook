// The compiled symbol table. A .dict file is the toolchain's other half —
// tools/lexicon compiles open corpora into it offline — and this reader is
// the runtime loader: raw bytes in, a queryable Lexicon out, or a typed
// LexiconError. This is the boundary where an untrusted file becomes a precise
// type (parse, don't validate) — every structural read is bounds-checked and a
// corrupt or truncated file is a value, never a throw. It is the executable
// mirror of tools/lexicon/FORMAT.md, optimised for low-memory lookup: the sorted
// form table is binary-searched in place and no string is materialised until a
// form is actually hit. See FORMAT.md for the on-disk layout this parses.

import { err, ok } from "../result"
import type { Result } from "../result"
import {
  byteToPos,
  byteToVariant,
  byteToVariantScheme,
  compareBytes,
} from "./model"
import type { Entry, Pos, SyntaxData, Variant, VariantScheme } from "./model"

// Which spelling variants a lookup admits. "both" always passes; en-US keeps
// "us", en-UK keeps "uk", "all" keeps everything (the natural choice for pt-BR,
// whose entries are all "both" anyway).
export type VariantScope =
  | { kind: "all" }
  | { kind: "us" }
  | { kind: "uk" }

export type LexiconError =
  | { kind: "bad-magic" }
  | { kind: "bad-version"; found: number }
  | { kind: "truncated"; section: string; needed: number; had: number }
  | { kind: "bad-variant-scheme"; byte: number }
  | { kind: "bad-trailer" }
  | { kind: "corrupt-entry"; index: number; reason: string }
  | { kind: "bad-syntax"; message: string }

export type Lexicon = {
  lang: string
  variantScheme: VariantScheme
  formCount: number
  entryCount: number
  syntax: SyntaxData
  lookup: (form: string, scope: VariantScope) => readonly Entry[]
}

// A pool is a UTF-8 blob plus offsets[count+1]; string j is the byte range
// [offsets[j] .. offsets[j+1]) inside the blob.
type Pool = {
  bytes: Uint8Array
  offsets: Uint32Array
}

type Cursor = {
  data: Uint8Array
  view: DataView
  off: number
}

// Advance by `n` bytes, failing closed if the file is shorter than it claims.
// Returns the start offset the caller reads from.
function take(c: Cursor, n: number, section: string): Result<number, LexiconError> {
  const start = c.off
  const end = start + n

  switch (end > c.data.length) {
    case true:
      return err({ kind: "truncated", section, needed: end, had: c.data.length })
    case false:
      c.off = end
      return ok(start)
  }
}

function readU8(c: Cursor, section: string): Result<number, LexiconError> {
  const at = take(c, 1, section)

  switch (at.ok) {
    case false:
      return at
    case true:
      return ok(c.view.getUint8(at.value))
  }
}

function readU16(c: Cursor, section: string): Result<number, LexiconError> {
  const at = take(c, 2, section)

  switch (at.ok) {
    case false:
      return at
    case true:
      return ok(c.view.getUint16(at.value, true))
  }
}

function readU32(c: Cursor, section: string): Result<number, LexiconError> {
  const at = take(c, 4, section)

  switch (at.ok) {
    case false:
      return at
    case true:
      return ok(c.view.getUint32(at.value, true))
  }
}

function readU32Array(
  c: Cursor,
  count: number,
  section: string,
): Result<Uint32Array, LexiconError> {
  const at = take(c, count * 4, section)

  switch (at.ok) {
    case false:
      return at
    case true: {
      const out = new Uint32Array(count)

      for (let i = 0; i < count; i++) {
        out[i] = c.view.getUint32(at.value + i * 4, true)
      }

      return ok(out)
    }
  }
}

function readBlob(c: Cursor, len: number, section: string): Result<Uint8Array, LexiconError> {
  const at = take(c, len, section)

  switch (at.ok) {
    case false:
      return at
    case true:
      return ok(c.data.subarray(at.value, at.value + len))
  }
}

function readPool(c: Cursor, count: number, section: string): Result<Pool, LexiconError> {
  const blobLen = readU32(c, `${section}.blobLen`)

  switch (blobLen.ok) {
    case false:
      return blobLen
    case true:
      break
  }

  const offsets = readU32Array(c, count + 1, `${section}.offsets`)

  switch (offsets.ok) {
    case false:
      return offsets
    case true:
      break
  }

  const blob = readBlob(c, blobLen.value, `${section}.blob`)

  switch (blob.ok) {
    case false:
      return blob
    case true:
      return ok({ bytes: blob.value, offsets: offsets.value })
  }
}

function decodeString(dec: InstanceType<typeof TextDecoder>, pool: Pool, id: number): string {
  const start = pool.offsets[id]!
  const end = pool.offsets[id + 1]!

  return dec.decode(pool.bytes.subarray(start, end))
}

const MAGIC_HEAD = [0x4d, 0x42, 0x4c, 0x58] as const

const MAGIC_TAIL = [0x58, 0x4c, 0x42, 0x4d] as const

function matchesMagic(data: Uint8Array, at: number, magic: readonly number[]): boolean {
  return (
    data[at] === magic[0] &&
    data[at + 1] === magic[1] &&
    data[at + 2] === magic[2] &&
    data[at + 3] === magic[3]
  )
}

// After open, every entry byte is known valid, so decoding one cannot fail; the
// none branch is a proven-unreachable invariant, the one sanctioned throw.
function posOrThrow(b: number): Pos {
  const p = byteToPos(b)

  switch (p.kind) {
    case "some":
      return p.value
    case "none":
      throw new Error(`invariant: pos byte ${b} was validated at open`)
  }
}

function variantOrThrow(b: number): Variant {
  const v = byteToVariant(b)

  switch (v.kind) {
    case "some":
      return v.value
    case "none":
      throw new Error(`invariant: variant byte ${b} was validated at open`)
  }
}

function admits(scope: VariantScope, variant: Variant): boolean {
  switch (scope.kind) {
    case "all":
      return true
    case "us":
      return variant === "both" || variant === "us"
    case "uk":
      return variant === "both" || variant === "uk"
  }
}

type Tables = {
  lang: string
  scheme: VariantScheme
  formCount: number
  entryCount: number
  lemmaCount: number
  featCount: number
  formOffsets: Uint32Array
  formBlob: Uint8Array
  entryStart: Uint32Array
  entriesBase: number
  lemma: Pool
  feat: Pool
  syntax: SyntaxData
}

// Walk the header and every table region once, bounds-checking as we go. On
// return the whole file is provably addressable and the offset tables are built;
// the caller still validates entry contents before trusting lookups.
function readTables(c: Cursor): Result<Tables, LexiconError> {
  const head = take(c, 4, "magic")

  switch (head.ok) {
    case false:
      return head
    case true:
      break
  }

  switch (matchesMagic(c.data, head.value, MAGIC_HEAD)) {
    case false:
      return err({ kind: "bad-magic" })
    case true:
      break
  }

  const version = readU32(c, "version")

  switch (version.ok) {
    case false:
      return version
    case true:
      break
  }

  switch (version.value === 6) {
    case false:
      return err({ kind: "bad-version", found: version.value })
    case true:
      break
  }

  const langLen = readU8(c, "langLen")

  switch (langLen.ok) {
    case false:
      return langLen
    case true:
      break
  }

  const langBytes = readBlob(c, langLen.value, "lang")

  switch (langBytes.ok) {
    case false:
      return langBytes
    case true:
      break
  }

  const schemeByte = readU8(c, "variantScheme")

  switch (schemeByte.ok) {
    case false:
      return schemeByte
    case true:
      break
  }

  const scheme = byteToVariantScheme(schemeByte.value)

  switch (scheme.kind) {
    case "none":
      return err({ kind: "bad-variant-scheme", byte: schemeByte.value })
    case "some":
      break
  }

  const formCount = readU32(c, "formCount")

  switch (formCount.ok) {
    case false:
      return formCount
    case true:
      break
  }

  const entryCount = readU32(c, "entryCount")

  switch (entryCount.ok) {
    case false:
      return entryCount
    case true:
      break
  }

  const lemmaCount = readU32(c, "lemmaCount")

  switch (lemmaCount.ok) {
    case false:
      return lemmaCount
    case true:
      break
  }

  const featCount = readU16(c, "featCount")

  switch (featCount.ok) {
    case false:
      return featCount
    case true:
      break
  }

  const formBlobLen = readU32(c, "formBlobLen")

  switch (formBlobLen.ok) {
    case false:
      return formBlobLen
    case true:
      break
  }

  const formOffsets = readU32Array(c, formCount.value + 1, "formOffsets")

  switch (formOffsets.ok) {
    case false:
      return formOffsets
    case true:
      break
  }

  const formBlob = readBlob(c, formBlobLen.value, "formBlob")

  switch (formBlob.ok) {
    case false:
      return formBlob
    case true:
      break
  }

  const entryStart = readU32Array(c, formCount.value + 1, "entryStart")

  switch (entryStart.ok) {
    case false:
      return entryStart
    case true:
      break
  }

  const entries = take(c, entryCount.value * 8, "entries")

  switch (entries.ok) {
    case false:
      return entries
    case true:
      break
  }

  const lemma = readPool(c, lemmaCount.value, "lemmaPool")

  switch (lemma.ok) {
    case false:
      return lemma
    case true:
      break
  }

  const feat = readPool(c, featCount.value, "featPool")

  switch (feat.ok) {
    case false:
      return feat
    case true:
      break
  }

  const syntax = readSyntax(c)

  switch (syntax.ok) {
    case false:
      return syntax
    case true:
      break
  }

  const trailer = take(c, 4, "trailer")

  switch (trailer.ok) {
    case false:
      return trailer
    case true:
      break
  }

  switch (matchesMagic(c.data, trailer.value, MAGIC_TAIL)) {
    case false:
      return err({ kind: "bad-trailer" })
    case true:
      break
  }

  return ok({
    lang: new TextDecoder().decode(langBytes.value),
    scheme: scheme.value,
    formCount: formCount.value,
    entryCount: entryCount.value,
    lemmaCount: lemmaCount.value,
    featCount: featCount.value,
    formOffsets: formOffsets.value,
    formBlob: formBlob.value,
    entryStart: entryStart.value,
    entriesBase: entries.value,
    lemma: lemma.value,
    feat: feat.value,
    syntax: syntax.value,
  })
}

// The syntax section is one hand-authored JSON object; a malformed one is a
// typed error, so JSON.parse is caught here at its own small boundary.
function readSyntax(c: Cursor): Result<SyntaxData, LexiconError> {
  const len = readU32(c, "syntaxLen")

  switch (len.ok) {
    case false:
      return len
    case true:
      break
  }

  const blob = readBlob(c, len.value, "syntaxJson")

  switch (blob.ok) {
    case false:
      return blob
    case true:
      break
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(blob.value)) as SyntaxData

    return ok(parsed)
  } catch (caught) {
    return err({ kind: "bad-syntax", message: messageOf(caught) })
  }
}

// One pass over every entry record, checking each references a real POS,
// variant, lemma and feature. This turns lookup into a total function: after it
// passes, decoding an entry can never fail, so lookup returns Entry[] not Result.
function validateEntries(t: Tables, view: DataView): Result<void, LexiconError> {
  for (let k = 0; k < t.entryCount; k++) {
    const base = t.entriesBase + k * 8

    const lemmaRef = view.getUint32(base, true)
    const pos = byteToPos(view.getUint8(base + 4))
    const variant = byteToVariant(view.getUint8(base + 5))
    const featRef = view.getUint16(base + 6, true)

    switch (pos.kind) {
      case "none":
        return err({ kind: "corrupt-entry", index: k, reason: "bad POS byte" })
      case "some":
        break
    }

    switch (variant.kind) {
      case "none":
        return err({ kind: "corrupt-entry", index: k, reason: "bad variant byte" })
      case "some":
        break
    }

    switch (lemmaRef >= t.lemmaCount) {
      case true:
        return err({ kind: "corrupt-entry", index: k, reason: "lemma ref out of range" })
      case false:
        break
    }

    switch (featRef >= t.featCount) {
      case true:
        return err({ kind: "corrupt-entry", index: k, reason: "feat ref out of range" })
      case false:
        break
    }
  }

  return ok(undefined)
}

export function openLexicon(data: Uint8Array): Result<Lexicon, LexiconError> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const c: Cursor = { data, view, off: 0 }

  const tables = readTables(c)

  switch (tables.ok) {
    case false:
      return tables
    case true:
      break
  }

  const t = tables.value

  const validated = validateEntries(t, view)

  switch (validated.ok) {
    case false:
      return validated
    case true:
      break
  }

  const enc = new TextEncoder()
  const dec = new TextDecoder()

  const findForm = (query: Uint8Array): number => {
    let lo = 0
    let hi = t.formCount - 1

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const slice = t.formBlob.subarray(t.formOffsets[mid]!, t.formOffsets[mid + 1]!)
      const cmp = compareBytes(query, slice)

      switch (Math.sign(cmp)) {
        case 0:
          return mid
        case -1:
          hi = mid - 1
          break
        case 1:
          lo = mid + 1
          break
      }
    }

    return -1
  }

  const decodeEntry = (k: number): Entry => {
    const base = t.entriesBase + k * 8

    return {
      lemma: decodeString(dec, t.lemma, view.getUint32(base, true)),
      pos: posOrThrow(view.getUint8(base + 4)),
      feat: decodeString(dec, t.feat, view.getUint16(base + 6, true)),
      variant: variantOrThrow(view.getUint8(base + 5)),
    }
  }

  const lookup = (form: string, scope: VariantScope): readonly Entry[] => {
    const idx = findForm(enc.encode(form))

    switch (idx < 0) {
      case true:
        return []
      case false: {
        const start = t.entryStart[idx]!
        const end = t.entryStart[idx + 1]!
        const out: Entry[] = []

        for (let k = start; k < end; k++) {
          const entry = decodeEntry(k)

          switch (admits(scope, entry.variant)) {
            case true:
              out.push(entry)
              break
            case false:
              break
          }
        }

        return out
      }
    }
  }

  return ok({
    lang: t.lang,
    variantScheme: t.scheme,
    formCount: t.formCount,
    entryCount: t.entryCount,
    syntax: t.syntax,
    lookup,
  })
}

function messageOf(caught: unknown): string {
  switch (caught instanceof Error) {
    case true:
      return (caught as Error).message
    case false:
      return String(caught)
  }
}
