// Parser for VarCon (Kevin Atkinson) -> per-spelling US/UK variant tag.
// Data line grammar:  TAGS: word / TAGS: word / ...  (alternatives split by
// ` / `; a trailing ` | ...` annotation is dropped). A TAGS token is an
// uppercase variety letter plus optional modifiers: A American, B British(-ise),
// Z British(-ize/Oxford), C Canadian, D Australian.
//   A spelling is US-usable iff some tag starts with A;
//   UK-usable iff some tag starts with B or Z.
// Lines beginning with `#` are cluster headers.

import type { Variant } from "../format/model"

type Membership = {
  us: boolean
  uk: boolean
}

function unionInto(acc: Map<string, Membership>, word: string, tags: string[]): void {
  const us = tags.some((t) => t.startsWith("A"))
  const uk = tags.some((t) => t.startsWith("B") || t.startsWith("Z"))

  const prev = acc.get(word)

  switch (prev === undefined) {
    case true:
      acc.set(word, { us, uk })
      break
    case false:
      acc.set(word, { us: prev!.us || us, uk: prev!.uk || uk })
  }
}

function parseLine(acc: Map<string, Membership>, line: string): void {
  switch (line.length === 0 || line.startsWith("#")) {
    case true:
      return
    case false:
      break
  }

  for (const alt of line.split(" / ")) {
    const colon = alt.indexOf(": ")

    switch (colon < 0) {
      case true:
        break
      case false: {
        const tags = alt.slice(0, colon).trim().split(/\s+/).filter((t) => t.length > 0)
        const rhs = alt.slice(colon + 2)
        const word = rhs.split(" |")[0]!.trim()

        switch (word.length === 0) {
          case true:
            break
          case false:
            unionInto(acc, word, tags)
        }
      }
    }
  }
}

function toVariant(m: Membership): Variant {
  switch (m.us) {
    case true:
      switch (m.uk) {
        case true:
          return "both"
        case false:
          return "us"
      }
    case false:
      switch (m.uk) {
        case true:
          return "uk"
        case false:
          return "both"
      }
  }
}

export function parseVarcon(text: string): Map<string, Variant> {
  const acc = new Map<string, Membership>()

  for (const raw of text.split("\n")) {
    parseLine(acc, raw.replace(/\r$/, ""))
  }

  const out = new Map<string, Variant>()
  for (const [word, m] of acc) {
    out.set(word, toVariant(m))
  }

  return out
}

export const _internal = { parseLine, toVariant, unionInto }
