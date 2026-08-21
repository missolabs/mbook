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
      return withModernTwins([{ form, lemma, pos, feat: "", variant: "both" }])
    case false: {
      const codes = codesRaw.split(":").filter((c) => c.length > 0)
      return withModernTwins(codes.map((feat) => ({ form, lemma, pos, feat: mergePerson(feat), variant: "both" })))
    }
  }
}

// The shared-form tenses (imperfeito I, mais-que-perfeito Q, condicional C,
// subjuntivos S/T/U, infinitivo pessoal W) do not distinguish 1st from 3rd
// singular — `esperava` is both — yet this DELAF labels them with ONE person,
// usually 1s and sometimes both on separate lines. The merge represents the
// ambiguity honestly: I1s and I3s both become I13s (the duplicate collapses
// at encode), so person gates read AMBIGUITY instead of an artifact.
function mergePerson(feat: string): string {
  const shared = /^([IQCSTUW])[13](s)$/.exec(feat)

  switch (shared === null) {
    case true:
      return feat
    case false:
      return `${shared![1]}13${shared![2]}`
  }
}

// Each pre-reform entry also ships under its 1990-agreement spelling — the
// dictionary predates parts of the reform (idéia, vôo, lingüiça), and a book
// written today misses them all. Both spellings resolve.
function withModernTwins(entries: LexEntry[]): LexEntry[] {
  const out: LexEntry[] = []

  for (const e of entries) {
    out.push(e)

    const modern = modernize(e.form)

    switch (modern === e.form) {
      case true:
        break
      case false:
        out.push({ form: modern, lemma: modernize(e.lemma), pos: e.pos, feat: e.feat, variant: e.variant })
    }
  }

  return out
}

// Diminutive lemma links deliberately have NO derivation pass here: DELAF
// links the true diminutives natively (`gatinho,gato.N+Dim:Dms`,
// `casinha,casa`), and every candidate a surface rule would add on top of
// that is a lexicalized FALSE diminutive a base-existence check cannot catch
// (galinha is not a little gala, focinho not a little foco, golfinho not a
// little golfo — which is exactly why the dictionary left them unlinked).
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

// DELAF 2015 predates parts of the 1990 orthographic agreement: the noun is
// spelled idéia, the flight vôo, the sausage lingüiça — and a book written
// today misses them all. Each pre-reform form ALSO ships under its modern
// spelling (the old form stays, so either orthography resolves):
//   * the trema is abolished outright (ü -> u);
//   * the circumflex drops from ôo / êe (vôo -> voo, lêem -> leem);
//   * the acute drops from the open diphthongs éi / ói in paroxytones —
//     approximated as "followed by a vowel" (idéia -> ideia, jibóia ->
//     jiboia), which correctly leaves oxytones alone (herói, dói, heróis).
function modernize(s: string): string {
  return s
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U")
    .replace(/ôo/g, "oo")
    .replace(/êe/g, "ee")
    .replace(/éi(?=[aeiou])/g, "ei")
    .replace(/ói(?=[aeiou])/g, "oi")
}

// exported for the round-trip test's tiny fixture
export const _internal = { parseLine, mapPos, unescape, splitUnescaped }
