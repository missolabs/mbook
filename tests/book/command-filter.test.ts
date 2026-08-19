import { describe, expect, it } from "bun:test"

import { rankCommands } from "../../src/renderer/command/filter"
import type { Command } from "../../src/renderer/command/filter"

function cmd(id: string, group: string, title: string): Command {
  return { id, group, title, hint: "", run: () => {} }
}

const COMMANDS: readonly Command[] = [
  cmd("rosto", "navegação", "Página de rosto"),
  cmd("cap1", "navegação", "Capítulo 1 · O Telefone"),
  cmd("cap2", "navegação", "Capítulo 2 · O Poço"),
  cmd("nav", "exibição", "Alternar navegador"),
  cmd("zoom-in", "exibição", "Ampliar página"),
  cmd("save", "livro", "Guardar"),
]

function ids(commands: readonly Command[]): string[] {
  return commands.map((c) => c.id)
}

describe("command ranking", () => {
  it("returns everything in authored order for an empty query", () => {
    expect(ids(rankCommands(COMMANDS, ""))).toEqual(["rosto", "cap1", "cap2", "nav", "zoom-in", "save"])
    expect(ids(rankCommands(COMMANDS, "   "))).toEqual(["rosto", "cap1", "cap2", "nav", "zoom-in", "save"])
  })

  it("matches accent- and case-blind — `capitulo` reaches Capítulo", () => {
    expect(ids(rankCommands(COMMANDS, "capitulo"))).toEqual(["cap1", "cap2"])
    expect(ids(rankCommands(COMMANDS, "PÁGINA"))).toEqual(["rosto", "zoom-in"])
  })

  it("ranks a word-prefix hit above an inside hit", () => {
    // `na` starts the word `navegador` but only sits inside `Alternar`;
    // both beat nothing — and the word-prefix command comes first.
    const got = ids(rankCommands([cmd("a", "x", "Alternar navegador"), cmd("b", "x", "Panorama")], "na"))

    expect(got[0]).toBe("a")
  })

  it("still reaches a title through a scattered subsequence", () => {
    expect(ids(rankCommands(COMMANDS, "otel"))).toContain("cap1")
  })

  it("excludes what cannot match at all", () => {
    expect(rankCommands(COMMANDS, "xyzzy")).toEqual([])
  })

  it("keeps authored order between equally-scored commands", () => {
    // `Alternar` and `Ampliar` both word-prefix-match `a`; the authored
    // order between them must survive the sort.
    const got = ids(rankCommands(COMMANDS, "a"))

    expect(got.indexOf("nav")).toBeLessThan(got.indexOf("zoom-in"))
  })
})
