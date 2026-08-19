// The command model and its pure filter. A command is one action the bar can
// run — id, display group, title, an optional-by-emptiness shortcut hint, and
// the closure that does the work. Ranking is folded (case- and accent-blind)
// and tiered: a word of the title starting with the query beats the query
// appearing inside it, which beats a scattered subsequence; ties keep the
// authored order, so groups stay coherent when the query is broad.

import type { Optional } from "../../shared/optional"

export type Command = {
  id: string
  group: string
  title: string
  hint: string
  run: () => void
}

export function rankCommands(commands: readonly Command[], query: string): readonly Command[] {
  const folded = fold(query).trim()

  switch (folded.length === 0) {
    case true:
      return [...commands]
    case false:
      break
  }

  type Ranked = { command: Command; score: number; index: number }

  const ranked: Ranked[] = []

  commands.forEach((command, index) => {
    const score = matchScore(fold(command.title), folded)

    switch (score.kind) {
      case "none":
        return
      case "some":
        ranked.push({ command, score: score.value, index })
        return
    }
  })

  ranked.sort((a, b) => {
    switch (a.score === b.score) {
      case false:
        return b.score - a.score
      case true:
        return a.index - b.index
    }
  })

  return ranked.map((r) => r.command)
}

function matchScore(title: string, query: string): Optional<number> {
  const words = title.split(/[^\p{L}\p{Nd}]+/u)

  switch (words.some((word) => word.startsWith(query))) {
    case true:
      return { kind: "some", value: 3 }
    case false:
      break
  }

  switch (title.includes(query)) {
    case true:
      return { kind: "some", value: 2 }
    case false:
      break
  }

  switch (isSubsequence(title, query)) {
    case true:
      return { kind: "some", value: 1 }
    case false:
      return { kind: "none" }
  }
}

// Every query character appears in order inside the title — the loosest match
// tier ("otel" reaches "O Telefone").
function isSubsequence(title: string, query: string): boolean {
  let at = 0

  for (const ch of query) {
    switch (ch === " ") {
      case true:
        continue
      case false:
        break
    }

    const found = title.indexOf(ch, at)

    switch (found === -1) {
      case true:
        return false
      case false:
        at = found + 1
    }
  }

  return true
}

// Casefold + strip combining marks, so `capitulo` reaches `Capítulo`.
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
}
