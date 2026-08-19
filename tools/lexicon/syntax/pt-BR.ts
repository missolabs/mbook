// Hand-authored Brazilian-Portuguese syntax data compiled into pt-BR.dict
// alongside the lexicon. Same four roles as the English file: segmentation
// abbreviations, shallow chunk rules, unknown-word suffix guessing, valency.

import type { PatItem, Quant, SyntaxData } from "../format/model"
import type { Pos } from "../format/model"

function p(pos: Pos, quant: Quant): PatItem {
  return { pos, quant }
}

export const PT_BR_SYNTAX: SyntaxData = {
  closedClass: {
    determiners: [
      "o", "a", "os", "as", "um", "uma", "uns", "umas", "este", "esta",
      "estes", "estas", "esse", "essa", "esses", "essas", "aquele", "aquela",
      "aqueles", "aquelas", "meu", "minha", "meus", "minhas", "seu", "sua",
      "seus", "suas", "nosso", "nossa", "cada", "todo", "toda", "todos",
      "todas", "algum", "alguma", "nenhum", "nenhuma", "outro", "outra",
      "muito", "muita", "pouco", "pouca", "qual", "quais",
    ],
    pronouns: [
      "eu", "tu", "ele", "ela", "nós", "vós", "eles", "elas", "você", "vocês",
      "me", "te", "se", "lhe", "nos", "vos", "lhes", "mim", "ti", "si",
      "comigo", "contigo", "consigo", "conosco", "convosco", "que", "quem",
      "cujo", "cuja", "cujos", "cujas", "isto", "isso", "aquilo", "algo",
      "alguém", "ninguém", "tudo", "nada",
    ],
    prepositions: [
      "a", "ante", "após", "até", "com", "contra", "de", "desde", "em",
      "entre", "para", "perante", "por", "sem", "sob", "sobre", "trás",
      "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "à", "aos",
      "às", "pelo", "pela", "pelos", "pelas", "num", "numa", "dum", "duma",
      "deste", "desta", "nesse", "nessa", "àquele", "àquela", "dele", "dela",
    ],
    conjunctions: [
      "e", "ou", "mas", "porém", "contudo", "todavia", "entretanto", "porque",
      "pois", "que", "se", "como", "quando", "enquanto", "embora", "caso",
      "conforme", "portanto", "logo", "nem", "senão", "assim", "então",
      "porquanto", "mal",
    ],
    // Deictic and aspectual adverbs that never head an NP in running prose.
    // `assim` stays in conjunctions too: the double membership makes the closed
    // pass abstain and the context rules decide (`assim que` vs `assim mesmo`).
    adverbs: [
      "aqui", "aí", "ali", "cá", "lá", "acolá", "assim", "já", "ainda",
      "agora", "sempre", "nunca", "também", "não",
    ],
    abbreviations: [
      "Sr", "Sra", "Srta", "Dr", "Dra", "Prof", "Profa", "Exmo", "Exma", "etc",
      "pág", "p", "ex", "art", "av", "R", "núm", "cap", "vol", "fl", "séc",
      "ed", "org", "ltda", "cia", "tel", "end", "Ilmo", "Ilma", "Ltda",
    ],
  },
  chunkRules: [
    { chunk: "NP", pattern: [p("DET", "opt"), p("NUM", "opt"), p("ADJ", "star"), p("NOUN", "one"), p("NOUN", "star"), p("ADJ", "star")] },
    { chunk: "NP", pattern: [p("PROPN", "one"), p("PROPN", "star")] },
    { chunk: "NP", pattern: [p("PRON", "one")] },
    { chunk: "VP", pattern: [p("AUX", "star"), p("VERB", "one"), p("PRON", "star")] },
    { chunk: "PP", pattern: [p("ADP", "one"), p("DET", "opt"), p("ADJ", "star"), p("NOUN", "one"), p("ADJ", "star")] },
    { chunk: "PP", pattern: [p("ADP", "one"), p("PRON", "one")] },
  ],
  suffixGuess: [
    { suffix: "ção", pos: "NOUN" },
    { suffix: "ções", pos: "NOUN" },
    { suffix: "dade", pos: "NOUN" },
    { suffix: "agem", pos: "NOUN" },
    { suffix: "ismo", pos: "NOUN" },
    { suffix: "ista", pos: "NOUN" },
    { suffix: "eiro", pos: "NOUN" },
    { suffix: "eira", pos: "NOUN" },
    { suffix: "inho", pos: "NOUN" },
    { suffix: "inha", pos: "NOUN" },
    { suffix: "mente", pos: "ADV" },
    { suffix: "oso", pos: "ADJ" },
    { suffix: "osa", pos: "ADJ" },
    { suffix: "ável", pos: "ADJ" },
    { suffix: "ível", pos: "ADJ" },
    { suffix: "ico", pos: "ADJ" },
    { suffix: "ica", pos: "ADJ" },
    { suffix: "ado", pos: "ADJ" },
    { suffix: "ido", pos: "ADJ" },
    { suffix: "al", pos: "ADJ" },
    { suffix: "ês", pos: "ADJ" },
    { suffix: "ar", pos: "VERB" },
    { suffix: "er", pos: "VERB" },
    { suffix: "ir", pos: "VERB" },
    { suffix: "ando", pos: "VERB" },
    { suffix: "endo", pos: "VERB" },
    { suffix: "indo", pos: "VERB" },
    { suffix: "ou", pos: "VERB" },
  ],
  valency: [
    { lemma: "ser", frame: "copular" },
    { lemma: "estar", frame: "copular" },
    { lemma: "ficar", frame: "copular" },
    { lemma: "parecer", frame: "copular" },
    { lemma: "ir", frame: "intransitive" },
    { lemma: "vir", frame: "intransitive" },
    { lemma: "chegar", frame: "intransitive" },
    { lemma: "dormir", frame: "intransitive" },
    { lemma: "dar", frame: "ditransitive" },
    { lemma: "dizer", frame: "ditransitive" },
    { lemma: "entregar", frame: "ditransitive" },
    { lemma: "enviar", frame: "ditransitive" },
    { lemma: "ver", frame: "transitive" },
    { lemma: "fazer", frame: "transitive" },
    { lemma: "ter", frame: "transitive" },
    { lemma: "comer", frame: "transitive" },
    { lemma: "querer", frame: "transitive" },
    { lemma: "gostar", frame: "prepositional" },
    { lemma: "precisar", frame: "prepositional" },
    { lemma: "depender", frame: "prepositional" },
    { lemma: "morar", frame: "prepositional" },
    // Unaccusative/existential verbs: their sole argument surfaces AFTER the
    // verb and is a subject, never an object ("Aqui só existe o vento").
    { lemma: "existir", frame: "presentational" },
    { lemma: "haver", frame: "presentational" },
    { lemma: "faltar", frame: "presentational" },
    { lemma: "sobrar", frame: "presentational" },
    { lemma: "acontecer", frame: "presentational" },
    { lemma: "surgir", frame: "presentational" },
    { lemma: "restar", frame: "presentational" },
  ],
  // `se` also introduces complements ("vim ver se..."), but it is ambiguous
  // with the reflexive clitic, so only the unambiguous `que` is declared.
  complementizers: ["que"],
  // DELAF tense letters: P/I/J/F/Q presente..mais-que-perfeito, C condicional,
  // S/T/U subjuntivos, Y imperativo; W infinitivo (W1s.. pessoal). G gerúndio
  // and K particípio are neither finite nor infinitive and stay unlisted.
  verbFeats: {
    finitePrefixes: ["P", "I", "J", "F", "Q", "C", "S", "T", "U", "Y"],
    infinitivePrefixes: ["W"],
  },
}
