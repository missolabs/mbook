// Reference reader: .dict bytes -> queryable Dictionary handle. This is the
// executable specification a later app-side executor mirrors from FORMAT.md.
// It reads the whole file into one buffer and binary-searches the form table;
// no copy of the string data is made until a form is actually looked up.

import type { Pos, SyntaxData, Variant, VariantScheme } from "./model"
import { byteToPos, byteToVariant, byteToVariantScheme, err, ok } from "./model"
import type { Result } from "./model"
import { compareBytes } from "./encode"

export type Entry = {
  lemma: string
  pos: Pos
  feat: string
  variant: Variant
}

export type DictHandle = {
  lang: string
  variantScheme: VariantScheme
  formCount: number
  entryCount: number
  syntax: SyntaxData
  lookup: (form: string) => Entry[]
}

type Cursor = {
  view: DataView
  off: number
}

function readU8(c: Cursor): number {
  const v = c.view.getUint8(c.off)
  c.off += 1
  return v
}

function readU16(c: Cursor): number {
  const v = c.view.getUint16(c.off, true)
  c.off += 2
  return v
}

function readU32(c: Cursor): number {
  const v = c.view.getUint32(c.off, true)
  c.off += 4
  return v
}

type Pool = {
  bytes: Uint8Array
  offsets: Uint32Array // length count+1
}

function readPool(bytes: Uint8Array, c: Cursor, count: number): Pool {
  const blobLen = readU32(c)

  const offsets = new Uint32Array(count + 1)
  for (let i = 0; i <= count; i++) {
    offsets[i] = readU32(c)
  }

  const blobStart = c.off
  c.off += blobLen

  return { bytes: bytes.subarray(blobStart, blobStart + blobLen), offsets }
}

function decodeString(pool: Pool, id: number): string {
  const start = pool.offsets[id]!
  const end = pool.offsets[id + 1]!
  return new TextDecoder().decode(pool.bytes.subarray(start, end))
}

export function decodeDictionary(data: Uint8Array): Result<DictHandle, string> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const c: Cursor = { view, off: 0 }

  const m0 = readU8(c)
  const m1 = readU8(c)
  const m2 = readU8(c)
  const m3 = readU8(c)

  const magicOk = m0 === 0x4d && m1 === 0x42 && m2 === 0x4c && m3 === 0x58

  switch (magicOk) {
    case false:
      return err("bad header magic")
    case true:
      break
  }

  const version = readU32(c)

  switch (version === 5) {
    case false:
      return err(`unsupported format version ${version}`)
    case true:
      break
  }

  const langLen = readU8(c)
  const lang = new TextDecoder().decode(data.subarray(c.off, c.off + langLen))
  c.off += langLen

  const schemeRes = byteToVariantScheme(readU8(c))

  switch (schemeRes.ok) {
    case false:
      return schemeRes
    case true:
      break
  }

  const formCount = readU32(c)
  const entryCount = readU32(c)
  const lemmaCount = readU32(c)
  const featCount = readU16(c)

  const formBlobLen = readU32(c)

  const formOffsets = new Uint32Array(formCount + 1)
  for (let i = 0; i <= formCount; i++) {
    formOffsets[i] = readU32(c)
  }

  const formBlobStart = c.off
  const formBlob = data.subarray(formBlobStart, formBlobStart + formBlobLen)
  c.off += formBlobLen

  const entryStart = new Uint32Array(formCount + 1)
  for (let i = 0; i <= formCount; i++) {
    entryStart[i] = readU32(c)
  }

  const entriesOffset = c.off
  c.off += entryCount * 8

  const lemmaPool = readPool(data, c, lemmaCount)

  const featPool = readPool(data, c, featCount)

  const syntaxLen = readU32(c)
  const syntax = JSON.parse(
    new TextDecoder().decode(data.subarray(c.off, c.off + syntaxLen)),
  ) as SyntaxData
  c.off += syntaxLen

  const enc = new TextEncoder()

  const findForm = (queryBytes: Uint8Array): number => {
    let lo = 0
    let hi = formCount - 1

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const slice = formBlob.subarray(formOffsets[mid]!, formOffsets[mid + 1]!)
      const cmp = compareBytes(queryBytes, slice)

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

  const readEntry = (idx: number): Entry => {
    const base = entriesOffset + idx * 8
    const lemmaRef = view.getUint32(base, true)
    const pos = byteToPos(view.getUint8(base + 4))
    const variant = byteToVariant(view.getUint8(base + 5))
    const featRef = view.getUint16(base + 6, true)

    switch (pos.ok && variant.ok) {
      case false:
        throw new Error("corrupt entry record")
      case true:
        return {
          lemma: decodeString(lemmaPool, lemmaRef),
          pos: (pos as { ok: true; value: Pos }).value,
          feat: decodeString(featPool, featRef),
          variant: (variant as { ok: true; value: Variant }).value,
        }
    }
  }

  const lookup = (form: string): Entry[] => {
    const idx = findForm(enc.encode(form))

    switch (idx < 0) {
      case true:
        return []
      case false: {
        const start = entryStart[idx]!
        const end = entryStart[idx + 1]!
        const out: Entry[] = []
        for (let i = start; i < end; i++) {
          out.push(readEntry(i))
        }
        return out
      }
    }
  }

  return ok({
    lang,
    variantScheme: schemeRes.value,
    formCount,
    entryCount,
    syntax,
    lookup,
  })
}
