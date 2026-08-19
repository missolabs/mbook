// Parser for the Moby Part-of-Speech II database (Grady Ward, public domain).
// Line grammar:  WORD\CODES  where CODES is a string of single-char POS codes.
// Moby supplies POS breadth for closed-class words and adverbs that AGID (an
// inflection database of open-class words) does not cover. Multi-word entries
// are skipped: the lexicon is keyed on single surface tokens.

import type { LexEntry, Pos } from "../format/model"

// Moby code -> our POS. `p` (plural) and `h` (noun phrase) carry no base-form
// POS of their own and are dropped.
function mapCode(code: string): Pos | "skip" {
  switch (code) {
    case "N":
      return "NOUN"
    case "V":
      return "VERB"
    case "t":
      return "VERB"
    case "i":
      return "VERB"
    case "A":
      return "ADJ"
    case "v":
      return "ADV"
    case "C":
      return "CONJ"
    case "P":
      return "ADP"
    case "!":
      return "INTJ"
    case "r":
      return "PRON"
    case "D":
      return "DET"
    case "I":
      return "DET"
    case "o":
      return "PRON"
    default:
      return "skip"
  }
}

function parseLine(line: string): LexEntry[] {
  const sep = line.lastIndexOf("\\")

  switch (sep < 0) {
    case true:
      return []
    case false:
      break
  }

  const word = line.slice(0, sep)
  const codes = line.slice(sep + 1)

  switch (word.length === 0 || word.includes(" ")) {
    case true:
      return []
    case false:
      break
  }

  const seen = new Set<Pos>()
  const out: LexEntry[] = []

  for (const ch of codes) {
    const pos = mapCode(ch)

    switch (pos === "skip" || seen.has(pos as Pos)) {
      case true:
        break
      case false: {
        seen.add(pos as Pos)
        out.push({ form: word, lemma: word, pos: pos as Pos, feat: "", variant: "both" })
      }
    }
  }

  return out
}

export function parseMoby(text: string): LexEntry[] {
  const out: LexEntry[] = []

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "")
    switch (line.length === 0) {
      case true:
        break
      case false:
        for (const e of parseLine(line)) {
          out.push(e)
        }
    }
  }

  return out
}

export const _internal = { parseLine, mapCode }
