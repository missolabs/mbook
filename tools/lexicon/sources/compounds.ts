// Hand-curated Brazilian-Portuguese hyphenated compounds. The DELAF full-form
// dictionary ships none (its only hyphenated lines are the ~7.9M verb+clitic
// forms the build drops), so without this list the tokenizer's hyphen split
// shreds `quinta-feira` into `quinta` + `feira` and the tagger reads a verb
// (feirar) where prose meant a weekday. The tokenizer keeps a hyphenated word
// whole exactly when the lexicon knows the whole form — this file is what makes
// it know. Feat codes follow DELAF (m/f gender, s/p number).

import type { LexEntry, Pos } from "../format/model"

type Compound = {
  form: string
  lemma: string
  pos: Pos
  feat: string
}

function noun(form: string, lemma: string, feat: string): Compound {
  return { form, lemma, pos: "NOUN", feat }
}

function adj(form: string, lemma: string, feat: string): Compound {
  return { form, lemma, pos: "ADJ", feat }
}

// A masculine/feminine singular+plural noun family sharing one stem pattern:
// both halves inflect (`quintas-feiras`) or only the head does (`beija-flores`).
const COMPOUNDS: readonly Compound[] = [
  noun("segunda-feira", "segunda-feira", "fs"),
  noun("segundas-feiras", "segunda-feira", "fp"),
  noun("terça-feira", "terça-feira", "fs"),
  noun("terças-feiras", "terça-feira", "fp"),
  noun("quarta-feira", "quarta-feira", "fs"),
  noun("quartas-feiras", "quarta-feira", "fp"),
  noun("quinta-feira", "quinta-feira", "fs"),
  noun("quintas-feiras", "quinta-feira", "fp"),
  noun("sexta-feira", "sexta-feira", "fs"),
  noun("sextas-feiras", "sexta-feira", "fp"),
  noun("meia-noite", "meia-noite", "fs"),
  noun("meio-dia", "meio-dia", "ms"),
  noun("meia-lua", "meia-lua", "fs"),
  noun("meia-luz", "meia-luz", "fs"),
  noun("meia-idade", "meia-idade", "fs"),
  noun("guarda-chuva", "guarda-chuva", "ms"),
  noun("guarda-chuvas", "guarda-chuva", "mp"),
  noun("guarda-roupa", "guarda-roupa", "ms"),
  noun("guarda-roupas", "guarda-roupa", "mp"),
  noun("guarda-costas", "guarda-costas", "ms"),
  noun("guarda-sol", "guarda-sol", "ms"),
  noun("guarda-sóis", "guarda-sol", "mp"),
  noun("arco-íris", "arco-íris", "ms"),
  noun("beija-flor", "beija-flor", "ms"),
  noun("beija-flores", "beija-flor", "mp"),
  noun("couve-flor", "couve-flor", "fs"),
  noun("couves-flores", "couve-flor", "fp"),
  noun("obra-prima", "obra-prima", "fs"),
  noun("obras-primas", "obra-prima", "fp"),
  noun("matéria-prima", "matéria-prima", "fs"),
  noun("matérias-primas", "matéria-prima", "fp"),
  noun("primeiro-ministro", "primeiro-ministro", "ms"),
  noun("primeira-dama", "primeira-dama", "fs"),
  noun("vice-presidente", "vice-presidente", "ms"),
  noun("arranha-céu", "arranha-céu", "ms"),
  noun("arranha-céus", "arranha-céu", "mp"),
  noun("quebra-cabeça", "quebra-cabeça", "ms"),
  noun("quebra-cabeças", "quebra-cabeça", "mp"),
  noun("porta-retrato", "porta-retrato", "ms"),
  noun("porta-retratos", "porta-retrato", "mp"),
  noun("porta-voz", "porta-voz", "ms"),
  noun("porta-vozes", "porta-voz", "mp"),
  noun("lugar-comum", "lugar-comum", "ms"),
  noun("mal-estar", "mal-estar", "ms"),
  noun("bem-estar", "bem-estar", "ms"),
  noun("pós-guerra", "pós-guerra", "ms"),
  noun("para-brisa", "para-brisa", "ms"),
  noun("para-brisas", "para-brisa", "mp"),
  noun("salva-vidas", "salva-vidas", "ms"),
  noun("toca-discos", "toca-discos", "ms"),
  noun("contra-ataque", "contra-ataque", "ms"),
  noun("contra-ataques", "contra-ataque", "mp"),
  noun("recém-nascido", "recém-nascido", "ms"),
  noun("recém-nascidos", "recém-nascido", "mp"),
  adj("bem-vindo", "bem-vindo", "ms"),
  adj("bem-vinda", "bem-vindo", "fs"),
  adj("bem-vindos", "bem-vindo", "mp"),
  adj("bem-vindas", "bem-vindo", "fp"),
  adj("recém-chegado", "recém-chegado", "ms"),
  adj("recém-chegada", "recém-chegado", "fs"),
  adj("mal-assombrado", "mal-assombrado", "ms"),
  adj("mal-assombrada", "mal-assombrado", "fs"),
]

export function compoundEntries(): LexEntry[] {
  return COMPOUNDS.map((c) => ({
    form: c.form,
    lemma: c.lemma,
    pos: c.pos,
    feat: c.feat,
    variant: "both",
  }))
}
