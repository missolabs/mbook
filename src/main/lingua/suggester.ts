// The suggestion sidecar: for the diagnostics the deterministic signals
// cannot decide — an unowned pronoun, an empty binding — a local model is
// asked WHO, with the answer constrained to the declared cast. The exact
// dialect here (enum-forced JSON schema, temperature 0, seed 7, the cast
// registry line first) is the one the model battery verified at 13/13 with
// gemma3:12b; drift from it untested at your peril.
//
// The sidecar degrades to silence: no Ollama, no model, a timeout, an
// "incerto" — each is a suggestion that simply never arrives, never an
// error the author sees. Everything here is pure over an injected fetch;
// the analyzer owns scheduling and staleness.

import type { CastMember } from "../../shared/lingua/driver"
import type { Optional } from "../../shared/optional"

export type SuggestDeps = {
  fetch: typeof globalThis.fetch
  base: string
}

// The same item shape evt:diagnostics carries; `suggest` is what this module
// adds to the targets it can answer.
export type DiagnosticPayload = {
  kind: string
  from: number
  to: number
  detail: string
  suggest?: string
}

// Which models serve, best first. 12b answered the whole battery; 4b is the
// fast fallback at 11/13.
const MODELS = ["gemma3:12b", "gemma3:4b"]

const TARGET_KINDS = new Set(["unresolved-pronoun", "empty-binding"])

// A plural can never mean ONE cast member — the enum would force a bluff
// (the battery's dangling `elas` answered `Rei`). A dangling plural is the
// engine's split-antecedent rule to resolve; an authored plural glyph is the
// multi-name binding's (`{elas}[Esposa, Filha]`). Either way the sidecar
// refuses the question.
const PLURAL_PRONOUNS = new Set(["eles", "elas", "they", "them"])

// At most this many asks per analysis pass — a page of dangling pronouns must
// not queue a minute of model time behind a keystroke.
const CAP = 8

const TIMEOUT_MS = 15000

export function suggestTargets(items: readonly DiagnosticPayload[]): readonly DiagnosticPayload[] {
  const targets: DiagnosticPayload[] = []

  for (const item of items) {
    switch (TARGET_KINDS.has(item.kind) && targets.length < CAP) {
      case true:
        break
      case false:
        continue
    }

    switch (PLURAL_PRONOUNS.has(item.detail.trim().toLowerCase())) {
      case true:
        continue
      case false:
        targets.push(item)
        continue
    }
  }

  return targets
}

// The word being resolved: the pronoun is its own range; an empty binding's
// range covers the whole glyph, so the display rides `detail`.
export function wordOf(item: DiagnosticPayload, content: string): string {
  switch (item.kind) {
    case "empty-binding":
      return item.detail
    default:
      return content.slice(item.from, item.to)
  }
}

export type Prompt = {
  system: string
  user: string
  options: readonly string[]
}

// The battery's exact scaffold: registry line, excerpt with the target marked
// «so», the question, and the enum carrying every cast name plus the honest
// way out.
export function buildPrompt(content: string, item: DiagnosticPayload, cast: readonly CastMember[]): Prompt {
  const word = wordOf(item, content)
  const before = content.slice(Math.max(0, item.from - 350), item.from)
  const target = content.slice(item.from, item.to)
  const after = content.slice(item.to, Math.min(content.length, item.to + 250))

  const excerpt = `${before}«${target}»${after}`
  const registry = `Elenco: ${cast.map(castLine).join(", ")}.`
  const question = `No trecho, a quem se refere “${word}” (marcado com «»)?`

  return {
    system:
      "Você é o assistente de um editor de livros. Responda apenas com o JSON pedido, escolhendo a opção mais provável dado o trecho.",
    user: `${registry}\n${excerpt}\n\n${question}`,
    options: [...cast.map((member) => member.name), "incerto"],
  }
}

function castLine(member: CastMember): string {
  switch (member.gender) {
    case "f":
      return `${member.name} (mulher)`
    case "m":
      return `${member.name} (homem)`
    case "unknown":
      return member.name
  }
}

// The installed model that serves, best first — or none, which is the whole
// sidecar quietly standing down.
export async function pickModel(deps: SuggestDeps): Promise<Optional<string>> {
  try {
    const res = await deps.fetch(`${deps.base}/api/tags`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const data = (await res.json()) as { models?: { name?: string }[] }
    const installed = new Set((data.models ?? []).map((m) => m.name ?? ""))

    for (const model of MODELS) {
      switch (installed.has(model)) {
        case true:
          return { kind: "some", value: model }
        case false:
          continue
      }
    }

    return { kind: "none" }
  } catch {
    return { kind: "none" }
  }
}

export async function askOne(deps: SuggestDeps, model: string, prompt: Prompt): Promise<Optional<string>> {
  try {
    const res = await deps.fetch(`${deps.base}/api/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0, seed: 7 },
        think: false,
        format: {
          type: "object",
          properties: { answer: { type: "string", enum: prompt.options } },
          required: ["answer"],
        },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    })

    const data = (await res.json()) as { message?: { content?: string } }
    const answer = (JSON.parse(data.message?.content ?? "") as { answer?: string }).answer ?? ""

    switch (answer !== "incerto" && prompt.options.includes(answer)) {
      case true:
        return { kind: "some", value: answer }
      case false:
        return { kind: "none" }
    }
  } catch {
    return { kind: "none" }
  }
}

// Ask serially — one local model, one GPU, no point hammering it — and hand
// back the FULL diagnostics set with suggestions merged onto the targets that
// earned one. `answered` reports whether any did, so the caller can skip a
// pointless re-emit.
export async function suggestFixes(
  deps: SuggestDeps,
  model: string,
  content: string,
  cast: readonly CastMember[],
  items: readonly DiagnosticPayload[],
): Promise<{ items: readonly DiagnosticPayload[]; answered: number }> {
  const suggestions = new Map<string, string>()

  for (const target of suggestTargets(items)) {
    const answer = await askOne(deps, model, buildPrompt(content, target, cast))

    switch (answer.kind) {
      case "none":
        continue
      case "some":
        suggestions.set(keyOf(target), answer.value)
        continue
    }
  }

  return {
    items: items.map((item) => mergeOne(item, suggestions)),
    answered: suggestions.size,
  }
}

function mergeOne(item: DiagnosticPayload, suggestions: ReadonlyMap<string, string>): DiagnosticPayload {
  const suggest = suggestions.get(keyOf(item))

  switch (suggest === undefined) {
    case true:
      return item
    case false:
      return { ...item, suggest }
  }
}

function keyOf(item: DiagnosticPayload): string {
  return `${item.from}:${item.to}`
}
