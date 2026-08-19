import { describe, it, expect } from "bun:test"

import { parseBookDoc } from "../../src/shared/book/parse"
import { buildCast, resolve } from "../../src/shared/book/cast"

const doc = parseBookDoc([
  "---",
  "title: O Jardim",
  "character: João",
  "character: Senhor Almeida",
  "character: Maria",
  "---",
  "# O Jardim",
])

const cast = buildCast(doc)

describe("buildCast", () => {
  it("collects every declared character and slugs multi-word, accented names", () => {
    expect(cast.characters).toEqual([
      { name: "João", slug: "joao" },
      { name: "Senhor Almeida", slug: "senhor-almeida" },
      { name: "Maria", slug: "maria" },
    ])
  })

  it("ignores non-character frontmatter fields", () => {
    const names = cast.characters.map((character) => character.name)

    expect(names).not.toContain("O Jardim")
  })
})

describe("resolve", () => {
  it("binds a name case- and diacritic-insensitively", () => {
    expect(resolve(cast, "joão")).toEqual({ kind: "resolved", slug: "joao" })

    expect(resolve(cast, "JOAO")).toEqual({ kind: "resolved", slug: "joao" })

    expect(resolve(cast, "senhor almeida")).toEqual({ kind: "resolved", slug: "senhor-almeida" })
  })

  it("leaves an undeclared name unresolved, keeping what was written", () => {
    expect(resolve(cast, "Pedro")).toEqual({ kind: "unresolved", name: "Pedro" })
  })
})
