// The book's cast: the characters an author declares in frontmatter, one
// canonical name each (no aliases), plus a name matcher the glyph scanner uses
// to bind a mention to a declared character. Pure projection of a BookDoc.

import type { BookDoc } from "./parse"

export type Character = { name: string; slug: string }
export type Cast = { characters: readonly Character[] }

export type Resolution =
  | { kind: "resolved"; slug: string }
  | { kind: "unresolved"; name: string }

export function buildCast(doc: BookDoc): Cast {
  const characters: Character[] = []

  for (const [key, value] of frontmatterFields(doc)) {
    switch (key === "character") {
      case true:
        characters.push({ name: value, slug: slugify(value) })
        continue
      case false:
        continue
    }
  }

  return { characters }
}

// The book's declared world beyond its people: `place:` and `object:`
// frontmatter lines register the geography and the story-significant things
// (`place: B Bar`, `object: caderno`) — authored entity typing, the same
// declaration pattern `character:` set.
export type Declarations = {
  places: readonly string[]
  objects: readonly string[]
}

export function buildDeclarations(doc: BookDoc): Declarations {
  const places: string[] = []
  const objects: string[] = []

  for (const [key, value] of frontmatterFields(doc)) {
    switch (key) {
      case "place":
        places.push(value)
        continue
      case "object":
        objects.push(value)
        continue
      default:
        continue
    }
  }

  return { places, objects }
}

// Match a written name against the declared cast, case- and diacritic-
// insensitively (so `joão`, `JOÃO` and `João` all bind the same character). An
// undeclared name is unresolved, never an error — the app never bothers the
// author about it.
export function resolve(cast: Cast, name: string): Resolution {
  const key = foldKey(name)

  for (const character of cast.characters) {
    switch (foldKey(character.name) === key) {
      case true:
        return { kind: "resolved", slug: character.slug }
      case false:
        continue
    }
  }

  return { kind: "unresolved", name }
}

function frontmatterFields(doc: BookDoc): readonly (readonly [string, string])[] {
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "frontmatter":
        return block.fields
      default:
        continue
    }
  }

  return []
}

// Slug: kebab-case of the deaccented name — `Senhor Almeida` -> `senhor-almeida`.
function slugify(name: string): string {
  const flat = deaccent(name).toLowerCase()
  const dashed = flat.replace(/[^a-z0-9]+/g, "-")

  return dashed.replace(/^-+|-+$/g, "")
}

// The comparison key for resolution: accents stripped, case folded. Exported so
// completion can filter the cast against a partial with the same fold the
// scanner binds names with — one normalization, no drift.
export function foldKey(name: string): string {
  return deaccent(name).toLowerCase().trim()
}

// Unicode NFD splits a letter from its combining marks; dropping the marks
// (U+0300..U+036F) leaves the base letters, deaccented.
function deaccent(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}
