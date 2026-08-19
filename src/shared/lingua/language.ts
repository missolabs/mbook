// Target selection: which of the three supported languages a book is written
// in, read from its frontmatter, and how that choice selects a compiled
// dictionary and a spelling-variant scope — the pipeline's equivalent of a
// target triple. This is the one place a raw frontmatter string becomes a
// precise Language (parse, don't validate); every later pass speaks the
// union, never the string.

import type { BookDoc } from "../book/parse"
import type { VariantScope } from "./lexicon"

export type Language =
  | { kind: "pt-BR" }
  | { kind: "en-US" }
  | { kind: "en-UK" }

export type DictId = "pt-BR" | "en"

// Portuguese is the default: an absent or unrecognized `language:` field is a
// pt-BR book, never an error — the app never blocks on a typo in frontmatter.
export function readLanguage(doc: BookDoc): Language {
  const field = frontmatterValue(doc, "language")

  switch (field.kind) {
    case "none":
      return { kind: "pt-BR" }
    case "some":
      return classify(field.value)
  }
}

export function dictId(language: Language): DictId {
  switch (language.kind) {
    case "pt-BR":
      return "pt-BR"
    case "en-US":
      return "en"
    case "en-UK":
      return "en"
  }
}

export function variantScope(language: Language): VariantScope {
  switch (language.kind) {
    case "pt-BR":
      return { kind: "all" }
    case "en-US":
      return { kind: "us" }
    case "en-UK":
      return { kind: "uk" }
  }
}

function classify(raw: string): Language {
  switch (raw.toLowerCase().trim()) {
    case "pt-br":
      return { kind: "pt-BR" }
    case "pt":
      return { kind: "pt-BR" }
    case "en-us":
      return { kind: "en-US" }
    case "en":
      return { kind: "en-US" }
    case "en-uk":
      return { kind: "en-UK" }
    case "en-gb":
      return { kind: "en-UK" }
    default:
      return { kind: "pt-BR" }
  }
}

type FieldValue = { kind: "none" } | { kind: "some"; value: string }

function frontmatterValue(doc: BookDoc, key: string): FieldValue {
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "frontmatter":
        return fieldOf(block.fields, key)
      default:
        continue
    }
  }

  return { kind: "none" }
}

function fieldOf(
  fields: readonly (readonly [string, string])[],
  key: string,
): FieldValue {
  for (const [name, value] of fields) {
    switch (name === key) {
      case true:
        return { kind: "some", value }
      case false:
        continue
    }
  }

  return { kind: "none" }
}
