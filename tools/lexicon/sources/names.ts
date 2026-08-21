// Curated first names with GENDER, shipped as PROPN entries in BOTH
// lexicons — the compile-time-data pattern: anaphora needs the gender the
// dictionaries lack (`Kirie ... Ela` must agree), and a reviewed, frozen
// table is world knowledge the runtime can consume deterministically.
// Curation bias: no name that collides with a frequent common word in
// either language (Bela, Rosa the flower is fine — capitalized lookup only);
// the Japanese names are the house corpus's (Mishima/Dazai/Murakami/Ito
// voices). `Rei` IS here despite rei-the-king: capitalized mid-prose it is
// a person, and the entry finally gives the collision an authored answer.

import type { LexEntry } from "../format/model"

type Named = readonly [string, "m" | "f"]

const NAMES: readonly Named[] = [
  // pt-BR feminine
  ["Ana", "f"], ["Alice", "f"], ["Beatriz", "f"], ["Bruna", "f"],
  ["Camila", "f"], ["Carla", "f"], ["Carolina", "f"], ["Cecília", "f"],
  ["Clara", "f"], ["Daniela", "f"], ["Elisa", "f"], ["Fernanda", "f"],
  ["Gabriela", "f"], ["Helena", "f"], ["Inês", "f"], ["Isabela", "f"],
  ["Joana", "f"], ["Júlia", "f"], ["Julia", "f"], ["Larissa", "f"],
  ["Laura", "f"], ["Letícia", "f"], ["Luana", "f"], ["Luiza", "f"],
  ["Lúcia", "f"], ["Manuela", "f"], ["Maria", "f"], ["Mariana", "f"],
  ["Marta", "f"], ["Patrícia", "f"], ["Paula", "f"], ["Priscila", "f"],
  ["Rafaela", "f"], ["Regina", "f"], ["Renata", "f"], ["Sandra", "f"],
  ["Sara", "f"], ["Simone", "f"], ["Sofia", "f"], ["Tatiana", "f"],
  ["Teresa", "f"], ["Vera", "f"], ["Vitória", "f"],
  // pt-BR masculine
  ["André", "m"], ["Antônio", "m"], ["Arthur", "m"], ["Bernardo", "m"],
  ["Bruno", "m"], ["Caio", "m"], ["Carlos", "m"], ["Daniel", "m"],
  ["Davi", "m"], ["Diego", "m"], ["Eduardo", "m"], ["Enzo", "m"],
  ["Felipe", "m"], ["Fernando", "m"], ["Francisco", "m"], ["Gabriel", "m"],
  ["Gustavo", "m"], ["Henrique", "m"], ["João", "m"], ["Jorge", "m"],
  ["José", "m"], ["Leonardo", "m"], ["Lucas", "m"], ["Luiz", "m"],
  ["Marcelo", "m"], ["Marcos", "m"], ["Mateus", "m"], ["Miguel", "m"],
  ["Otávio", "m"], ["Paulo", "m"], ["Pedro", "m"], ["Rafael", "m"],
  ["Ricardo", "m"], ["Roberto", "m"], ["Rodrigo", "m"], ["Samuel", "m"],
  ["Sérgio", "m"], ["Thiago", "m"], ["Vicente", "m"], ["Vinícius", "m"],
  // the shelf's Japanese names
  ["Rei", "m"], ["Kumiko", "f"], ["Kirie", "f"], ["Mizoguchi", "m"],
  ["Yozo", "m"], ["Minoru", "m"], ["Kenzō", "m"], ["Naoko", "f"],
  ["Midori", "f"], ["Toru", "m"], ["Watanabe", "m"], ["Tanabe", "m"],
  // en
  ["Alice", "f"], ["Anne", "f"], ["Catherine", "f"], ["Elizabeth", "f"],
  ["Emma", "f"], ["Jane", "f"], ["Margaret", "f"], ["Mary", "f"],
  ["Sarah", "f"], ["Charles", "m"], ["Edward", "m"], ["George", "m"],
  ["Henry", "m"], ["Holmes", "m"], ["James", "m"], ["John", "m"],
  ["Peter", "m"], ["Richard", "m"], ["Robert", "m"], ["Thomas", "m"],
  ["Watson", "m"], ["William", "m"],
]

export function nameEntries(): LexEntry[] {
  const out: LexEntry[] = []

  for (const [form, gender] of NAMES) {
    out.push({ form, lemma: form, pos: "PROPN", feat: `${gender}s`, variant: "both" })
  }

  return out
}
