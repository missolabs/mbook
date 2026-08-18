// Typing aids for the manuscript editor: deferred em-dash conversion and pt-BR
// curly quotes. Pure decision function — the renderer applies the edit.

export type AidDecision =
  | { kind: "pass" }
  | { kind: "replace"; deleteBefore: number; insert: string }

export type AidContext = { before: string; typed: string }

const QUOTE_OPENERS: readonly string[] = ["(", "[", "—", "“"]

export function decideTypingAid(context: AidContext): AidDecision {
  const dash = tryEmDash(context)

  switch (dash.kind) {
    case "replace":
      return dash
    case "pass":
      return tryQuote(context)
  }
}

// Deferred so a literal `---` separator stays typeable: the two hyphens only
// fold into an em dash once the next keystroke is not itself a hyphen.
function tryEmDash(context: AidContext): AidDecision {
  const notHyphen = context.typed !== "-"
  const endsTwo = context.before.endsWith("--")
  const notThree = context.before.endsWith("---") === false
  const trigger = notHyphen && endsTwo && notThree

  switch (trigger) {
    case true:
      return { kind: "replace", deleteBefore: 2, insert: "—" + context.typed }
    case false:
      return { kind: "pass" }
  }
}

function tryQuote(context: AidContext): AidDecision {
  switch (context.typed === '"') {
    case false:
      return { kind: "pass" }
    case true:
      return { kind: "replace", deleteBefore: 0, insert: chooseQuote(context.before) }
  }
}

function chooseQuote(before: string): string {
  switch (opensQuote(before)) {
    case true:
      return "“"
    case false:
      return "”"
  }
}

function opensQuote(before: string): boolean {
  switch (before.length === 0) {
    case true:
      return true
    case false:
      break
  }

  const last = before.slice(-1)

  switch (last.trim().length === 0) {
    case true:
      return true
    case false:
      return QUOTE_OPENERS.includes(last)
  }
}
