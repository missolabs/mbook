// Parser for the Unitex-PB DELAF full-form dictionary (Delaf2015v04.dic).
// Line grammar (Unitex DELAF):  FORM,LEMMA.POSFEATS:CODE:CODE...
// where `,` `.` `:` `+` are field separators and are backslash-escaped when
// literal. Clitic verb+pronoun forms (POS carries "+PRO", form carries a
// hyphen) are dropped: they are ~7.9M of 9.1M lines, mechanically derivable,
// and would bloat the shipped table.

import type { LexEntry, Pos } from "../format/model"

type Split = {
  head: string
  rest: string
}

// Scan to the first UNescaped occurrence of `sep`. Returns the raw (still
// escaped) head and rest so callers unescape only the fields they keep.
function splitUnescaped(s: string, sep: string): Split {
  let i = 0

  while (i < s.length) {
    const ch = s[i]!

    switch (ch === "\\") {
      case true:
        i += 2
        break
      case false: {
        switch (ch === sep) {
          case true:
            return { head: s.slice(0, i), rest: s.slice(i + 1) }
          case false:
            i += 1
        }
      }
    }
  }

  return { head: s, rest: "" }
}

function unescape(s: string): string {
  let out = ""
  let i = 0

  while (i < s.length) {
    const ch = s[i]!

    switch (ch === "\\") {
      case true: {
        const next = s[i + 1]
        switch (next === undefined) {
          case true:
            i += 1
            break
          case false:
            out += next
            i += 2
        }
        break
      }
      case false:
        out += ch
        i += 1
    }
  }

  return out
}

function mapPos(posFeats: string): Pos {
  const plus = posFeats.indexOf("+")
  const cross = posFeats.indexOf("X")

  const cut = [plus, cross].filter((n) => n >= 0)
  const headEnd = cut.length === 0 ? posFeats.length : Math.min(...cut)
  const head = posFeats.slice(0, headEnd)

  const isProper = posFeats.includes("+Pr")

  switch (head) {
    case "N":
      switch (isProper) {
        case true:
          return "PROPN"
        case false:
          return "NOUN"
      }
    case "V":
      return "VERB"
    case "A":
      return "ADJ"
    case "ADV":
      return "ADV"
    case "PRO":
      return "PRON"
    case "DET":
      return "DET"
    case "PREP":
      return "ADP"
    case "CONJ":
      return "CONJ"
    case "INTERJ":
      return "INTJ"
    case "PFX":
      return "X"
    default:
      return "X"
  }
}

function parseLine(line: string): LexEntry[] {
  const trimmed = line.replace(/\r$/, "")

  switch (trimmed.length === 0) {
    case true:
      return []
    case false:
      break
  }

  const posDrop = trimmed.includes("+PRO")
  const cliticDrop = splitUnescaped(trimmed, ",").head.includes("-")

  switch (posDrop || cliticDrop) {
    case true:
      return []
    case false:
      break
  }

  const formSplit = splitUnescaped(trimmed, ",")
  const form = unescape(formSplit.head)

  const lemmaSplit = splitUnescaped(formSplit.rest, ".")
  const lemma = unescape(lemmaSplit.head)

  const posSplit = splitUnescaped(lemmaSplit.rest, ":")
  const pos = mapPos(posSplit.head)

  const codesRaw = posSplit.rest

  switch (codesRaw.length === 0) {
    case true:
      return [{ form, lemma, pos, feat: "", variant: "both" }]
    case false: {
      const codes = codesRaw.split(":").filter((c) => c.length > 0)
      return codes.map((feat) => ({ form, lemma, pos, feat, variant: "both" }))
    }
  }
}

export function parseDelaf(text: string): LexEntry[] {
  const withoutBom = text.replace(/^﻿/, "")

  const out: LexEntry[] = []

  for (const line of withoutBom.split("\n")) {
    for (const e of parseLine(line)) {
      out.push(e)
    }
  }

  return out
}

// exported for the round-trip test's tiny fixture
export const _internal = { parseLine, mapPos, unescape, splitUnescaped }
