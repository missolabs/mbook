// Ordering the offered cast: the completion list is ranked, never filtered —
// four deterministic signals, strongest first:
//   1. habit — the exact display group has been bound before (`{eu}[Narrador]`
//      twelve times); the author's own precedent outranks everything;
//   2. gender — the display group being bound (`{Ela}[`) declares a gender;
//      members the engine knows to match lead, unknowns hold the middle, the
//      opposite gender sinks to the bottom (still offered — the author may
//      know better);
//   3. recency — within a gender tier, the member mentioned nearest above the
//      cursor leads: the scene's active people are the likely referents;
//   4. declaration — never-mentioned members keep frontmatter order.
// Member genders are the engine's word, streamed per analysis over evt:cast
// and held here; between analyses the map may lag the text by one debounce,
// never by more. The ranking itself is pure — the map is an argument.

import type { Character } from "../../shared/book/cast"

export type Gender = "f" | "m" | "unknown"

export type CastGenderMap = ReadonlyMap<string, Gender>

const genders = new Map<string, Gender>()

export function setCastGenders(members: readonly { slug: string; gender: Gender }[]): void {
  genders.clear()

  for (const member of members) {
    genders.set(member.slug, member.gender)
  }
}

export function castGenders(): CastGenderMap {
  return genders
}

// The gender the author's display text declares, read from its leading word.
// A tiny closed class only (pt + en pronouns and articles) — this is a UI
// affordance for the current keystroke; the engine remains the authority.
const FEMININE = new Set(["ela", "elas", "dela", "delas", "a", "as", "she", "her", "hers"])
const MASCULINE = new Set(["ele", "eles", "dele", "deles", "o", "os", "he", "him", "his"])

export function displayGender(display: string): Gender {
  const lead = display.trim().toLowerCase().split(/\s+/)[0] ?? ""

  switch (FEMININE.has(lead)) {
    case true:
      return "f"
    case false:
      break
  }

  switch (MASCULINE.has(lead)) {
    case true:
      return "m"
    case false:
      return "unknown"
  }
}

export function rankCharacters(
  matches: readonly Character[],
  display: Gender,
  known: CastGenderMap,
  lastSeen: (name: string) => number,
  boundBefore: (name: string) => number,
): readonly Character[] {
  const scored = matches.map((character, index) => ({
    character,
    habit: boundBefore(character.name),
    tier: tierOf(display, known.get(character.slug) ?? "unknown"),
    seen: lastSeen(character.name),
    index,
  }))

  scored.sort((a, b) => b.habit - a.habit || a.tier - b.tier || b.seen - a.seen || a.index - b.index)

  return scored.map((entry) => entry.character)
}

function tierOf(display: Gender, member: Gender): number {
  switch (display) {
    case "unknown":
      return 1
    case "f":
    case "m":
      break
  }

  switch (member === display) {
    case true:
      return 0
    case false:
      break
  }

  switch (member) {
    case "unknown":
      return 1
    case "f":
    case "m":
      return 2
  }
}
