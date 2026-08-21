import { describe, it, expect } from "bun:test"

import { askOne, buildPrompt, pickModel, suggestFixes, suggestTargets, wordOf } from "../../src/main/lingua/suggester"
import type { DiagnosticPayload, SuggestDeps } from "../../src/main/lingua/suggester"
import type { CastMember } from "../../src/shared/lingua/driver"

const CAST: readonly CastMember[] = [
  { slug: "rei", name: "Rei", gender: "m" },
  { slug: "daniela", name: "Daniela", gender: "f" },
  { slug: "hellmanns", name: "Hellmanns", gender: "unknown" },
]

function fakeFetch(handler: (url: string, init?: RequestInit) => unknown): SuggestDeps {
  return {
    base: "http://test",
    fetch: (async (url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify(handler(String(url), init)))) as typeof globalThis.fetch,
  }
}

function chatAnswer(answer: string): unknown {
  return { message: { content: JSON.stringify({ answer }) } }
}

const CONTENT = "Vi Mizoguchi no mercado. Ela não me viu naquela manhã."

const PRONOUN: DiagnosticPayload = { kind: "unresolved-pronoun", from: 25, to: 28, detail: "" }

describe("suggestTargets", () => {
  it("keeps only the kinds a model can answer, capped at eight", () => {
    const noise: DiagnosticPayload[] = [
      { kind: "contested-token", from: 0, to: 4, detail: "casa" },
      { kind: "unresolved-name", from: 5, to: 8, detail: "Ana" },
    ]

    const many = Array.from({ length: 12 }, (_, i) => ({
      kind: i % 2 === 0 ? "unresolved-pronoun" : "empty-binding",
      from: i * 10,
      to: i * 10 + 3,
      detail: "Ela",
    }))

    const targets = suggestTargets([...noise, ...many])

    expect(targets.length).toBe(8)
    expect(targets.every((t) => t.kind === "unresolved-pronoun" || t.kind === "empty-binding")).toBe(true)
  })

  it("refuses a plural pronoun — no single cast member can be the answer", () => {
    const plurals: DiagnosticPayload[] = [
      { kind: "unresolved-pronoun", from: 0, to: 4, detail: "elas" },
      { kind: "unresolved-pronoun", from: 10, to: 14, detail: "Eles" },
      { kind: "unresolved-pronoun", from: 20, to: 24, detail: "they" },
    ]

    expect(suggestTargets(plurals)).toEqual([])

    // A plural empty binding is refused too: its honest answer is SEVERAL
    // names, which is the multi-name completion's job, not a single enum's.
    const authored: DiagnosticPayload = { kind: "empty-binding", from: 0, to: 9, detail: "elas" }

    expect(suggestTargets([authored])).toEqual([])

    // A singular display keeps its suggestion.
    const singular: DiagnosticPayload = { kind: "empty-binding", from: 0, to: 8, detail: "Ela" }

    expect(suggestTargets([singular])).toEqual([singular])
  })
})

describe("wordOf", () => {
  it("slices the pronoun from its own range", () => {
    expect(wordOf(PRONOUN, CONTENT)).toBe("Ela")
  })

  it("reads an empty binding's display from detail — its range is the whole glyph", () => {
    const item: DiagnosticPayload = { kind: "empty-binding", from: 0, to: 7, detail: "Ela" }

    expect(wordOf(item, "{Ela}[] correu.")).toBe("Ela")
  })
})

describe("buildPrompt — the battery's verified scaffold", () => {
  const prompt = buildPrompt(CONTENT, PRONOUN, CAST)

  it("leads with the cast registry, genders spelled out", () => {
    expect(prompt.user.startsWith("Elenco: Rei (homem), Daniela (mulher), Hellmanns.")).toBe(true)
  })

  it("marks the target in the excerpt and asks about the marked word", () => {
    expect(prompt.user).toContain("«Ela» não me viu")
    expect(prompt.user).toContain("a quem se refere “Ela”")
  })

  it("constrains the answer to the cast plus the honest way out", () => {
    expect(prompt.options).toEqual(["Rei", "Daniela", "Hellmanns", "incerto"])
  })
})

describe("askOne", () => {
  const prompt = buildPrompt(CONTENT, PRONOUN, CAST)

  it("returns a cast answer and sends the battery dialect", () => {
    let sent: Record<string, unknown> = {}

    const deps = fakeFetch((_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return chatAnswer("Daniela")
    })

    return askOne(deps, "gemma3:12b", prompt).then((answer) => {
      expect(answer).toEqual({ kind: "some", value: "Daniela" })
      expect(sent["options"]).toEqual({ temperature: 0, seed: 7 })
      expect(sent["stream"]).toBe(false)
      expect((sent["format"] as { properties: { answer: { enum: string[] } } }).properties.answer.enum).toContain(
        "incerto",
      )
    })
  })

  it("treats “incerto” as no answer", async () => {
    const deps = fakeFetch(() => chatAnswer("incerto"))

    expect(await askOne(deps, "m", prompt)).toEqual({ kind: "none" })
  })

  it("rejects an answer from outside the enum", async () => {
    const deps = fakeFetch(() => chatAnswer("Mizoguchi"))

    expect(await askOne(deps, "m", prompt)).toEqual({ kind: "none" })
  })

  it("degrades a broken response to silence, never a throw", async () => {
    const deps = fakeFetch(() => ({ message: { content: "not json" } }))

    expect(await askOne(deps, "m", prompt)).toEqual({ kind: "none" })
  })
})

describe("pickModel", () => {
  it("prefers 12b, falls back to 4b, stands down bare", async () => {
    const both = fakeFetch(() => ({ models: [{ name: "gemma3:4b" }, { name: "gemma3:12b" }] }))
    expect(await pickModel(both)).toEqual({ kind: "some", value: "gemma3:12b" })

    const small = fakeFetch(() => ({ models: [{ name: "gemma3:4b" }] }))
    expect(await pickModel(small)).toEqual({ kind: "some", value: "gemma3:4b" })

    const none = fakeFetch(() => ({ models: [{ name: "qwen3:4b" }] }))
    expect(await pickModel(none)).toEqual({ kind: "none" })
  })

  it("degrades an unreachable Ollama to none", async () => {
    const deps: SuggestDeps = {
      base: "http://test",
      fetch: (async () => {
        throw new Error("refused")
      }) as typeof globalThis.fetch,
    }

    expect(await pickModel(deps)).toEqual({ kind: "none" })
  })
})

describe("suggestFixes", () => {
  it("merges answers onto the targets and carries the rest untouched", async () => {
    const items: DiagnosticPayload[] = [
      { kind: "contested-token", from: 0, to: 4, detail: "casa" },
      PRONOUN,
    ]

    const deps = fakeFetch(() => chatAnswer("Daniela"))

    const result = await suggestFixes(deps, "gemma3:12b", CONTENT, CAST, items)

    expect(result.answered).toBe(1)
    expect(result.items[0]).toEqual(items[0]!)
    expect(result.items[1]).toEqual({ ...PRONOUN, suggest: "Daniela" })
  })

  it("an all-incerto pass answers zero — the caller skips the re-emit", async () => {
    const deps = fakeFetch(() => chatAnswer("incerto"))

    const result = await suggestFixes(deps, "gemma3:12b", CONTENT, CAST, [PRONOUN])

    expect(result.answered).toBe(0)
    expect(result.items).toEqual([PRONOUN])
  })
})
