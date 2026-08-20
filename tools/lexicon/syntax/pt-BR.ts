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
      // The enclitic allomorphs the hyphen split produces (`vê-lo` -> vê + lo);
      // `no`/`na` stay out — they collide with the em+o contractions.
      "lo", "la", "los", "las",
    ],
    prepositions: [
      "a", "ante", "após", "até", "com", "contra", "de", "desde", "em",
      "entre", "para", "perante", "por", "sem", "sob", "sobre", "trás",
      "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "à", "aos",
      "às", "pelo", "pela", "pelos", "pelas", "num", "numa", "dum", "duma",
      "deste", "desta", "nesse", "nessa", "àquele", "àquela", "dele", "dela",
      "neste", "nesta", "naquele", "naquela", "naquilo", "nisso", "nisto",
      "daquele", "daquela", "desse", "dessa", "disso", "disto", "daquilo",
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
    // `onde`/`antes`/`depois` matter doubly: each has a junk verb homograph
    // in DELAF that produced garbage relations ("onde" as a VERB subjecting
    // its clause), and `onde` is also the place-relative the located-in rule
    // reads.
    adverbs: [
      "aqui", "aí", "ali", "cá", "lá", "acolá", "assim", "já", "ainda",
      "agora", "sempre", "nunca", "também", "não", "só", "apenas", "quase",
      "talvez", "hoje", "ontem", "amanhã", "onde", "antes", "depois",
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
    { suffix: "íssimo", pos: "ADJ" },
    { suffix: "íssima", pos: "ADJ" },
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
  // Curated with a bias the tagger depends on: a valency hint also promotes a
  // sentence-initial finite reading over a noun homograph (pro-drop Portuguese
  // opens clauses on the verb), so verbs whose finite forms collide with
  // frequent nouns (sonhar/sonho, jantar, casar/casa) are deliberately absent.
  valency: [
    { lemma: "ser", frame: "copular" },
    { lemma: "estar", frame: "copular" },
    { lemma: "ficar", frame: "copular" },
    { lemma: "parecer", frame: "copular" },
    { lemma: "permanecer", frame: "copular" },
    { lemma: "virar", frame: "copular" },
    { lemma: "ir", frame: "intransitive" },
    { lemma: "dormir", frame: "intransitive" },
    { lemma: "morrer", frame: "intransitive" },
    { lemma: "nascer", frame: "intransitive" },
    { lemma: "cair", frame: "intransitive" },
    { lemma: "correr", frame: "intransitive" },
    { lemma: "andar", frame: "intransitive" },
    { lemma: "caminhar", frame: "intransitive" },
    { lemma: "voltar", frame: "intransitive" },
    { lemma: "sair", frame: "intransitive" },
    { lemma: "entrar", frame: "intransitive" },
    // `subir` is transitive: `subiu os degraus / a escada / o morro` is the
    // literary norm, and the plain `subiu ao templo` PP shape claims no
    // object either way.
    { lemma: "subir", frame: "transitive" },
    { lemma: "descer", frame: "intransitive" },
    { lemma: "desaparecer", frame: "intransitive" },
    { lemma: "sumir", frame: "intransitive" },
    { lemma: "sorrir", frame: "intransitive" },
    { lemma: "chorar", frame: "intransitive" },
    { lemma: "gritar", frame: "intransitive" },
    { lemma: "tremer", frame: "intransitive" },
    { lemma: "respirar", frame: "intransitive" },
    { lemma: "nadar", frame: "intransitive" },
    { lemma: "acordar", frame: "intransitive" },
    { lemma: "envelhecer", frame: "intransitive" },
    { lemma: "dar", frame: "ditransitive" },
    { lemma: "dizer", frame: "ditransitive" },
    { lemma: "entregar", frame: "ditransitive" },
    { lemma: "enviar", frame: "ditransitive" },
    { lemma: "trazer", frame: "ditransitive" },
    { lemma: "oferecer", frame: "ditransitive" },
    { lemma: "mostrar", frame: "ditransitive" },
    { lemma: "emprestar", frame: "ditransitive" },
    { lemma: "devolver", frame: "ditransitive" },
    { lemma: "contar", frame: "ditransitive" },
    { lemma: "prometer", frame: "ditransitive" },
    { lemma: "perguntar", frame: "ditransitive" },
    { lemma: "ver", frame: "transitive" },
    { lemma: "fazer", frame: "transitive" },
    { lemma: "ter", frame: "transitive" },
    { lemma: "comer", frame: "transitive" },
    { lemma: "querer", frame: "transitive" },
    { lemma: "saber", frame: "transitive" },
    { lemma: "olhar", frame: "transitive" },
    { lemma: "ouvir", frame: "transitive" },
    { lemma: "escutar", frame: "transitive" },
    { lemma: "sentir", frame: "transitive" },
    { lemma: "encontrar", frame: "transitive" },
    { lemma: "achar", frame: "transitive" },
    { lemma: "perder", frame: "transitive" },
    { lemma: "amar", frame: "transitive" },
    { lemma: "odiar", frame: "transitive" },
    { lemma: "esperar", frame: "transitive" },
    { lemma: "buscar", frame: "transitive" },
    { lemma: "procurar", frame: "transitive" },
    { lemma: "deixar", frame: "transitive" },
    { lemma: "levar", frame: "transitive" },
    { lemma: "pegar", frame: "transitive" },
    { lemma: "beber", frame: "transitive" },
    { lemma: "tomar", frame: "transitive" },
    { lemma: "esquecer", frame: "transitive" },
    { lemma: "notar", frame: "transitive" },
    { lemma: "perceber", frame: "transitive" },
    { lemma: "compreender", frame: "transitive" },
    { lemma: "entender", frame: "transitive" },
    { lemma: "imaginar", frame: "transitive" },
    { lemma: "observar", frame: "transitive" },
    { lemma: "abraçar", frame: "transitive" },
    { lemma: "beijar", frame: "transitive" },
    { lemma: "matar", frame: "transitive" },
    { lemma: "temer", frame: "transitive" },
    { lemma: "chamar", frame: "transitive" },
    { lemma: "conhecer", frame: "transitive" },
    { lemma: "receber", frame: "transitive" },
    { lemma: "abrir", frame: "transitive" },
    { lemma: "fechar", frame: "transitive" },
    { lemma: "escrever", frame: "transitive" },
    { lemma: "ler", frame: "transitive" },
    { lemma: "segurar", frame: "transitive" },
    { lemma: "repetir", frame: "transitive" },
    { lemma: "murmurar", frame: "transitive" },
    { lemma: "sussurrar", frame: "transitive" },
    { lemma: "atravessar", frame: "transitive" },
    { lemma: "vestir", frame: "transitive" },
    { lemma: "carregar", frame: "transitive" },
    { lemma: "acender", frame: "transitive" },
    { lemma: "apagar", frame: "transitive" },
    { lemma: "guardar", frame: "transitive" },
    { lemma: "gostar", frame: "prepositional" },
    { lemma: "precisar", frame: "prepositional" },
    { lemma: "depender", frame: "prepositional" },
    { lemma: "morar", frame: "prepositional" },
    { lemma: "pensar", frame: "prepositional" },
    { lemma: "acreditar", frame: "prepositional" },
    { lemma: "lembrar", frame: "prepositional" },
    { lemma: "duvidar", frame: "prepositional" },
    { lemma: "confiar", frame: "prepositional" },
    // Unaccusative/existential verbs: their sole argument surfaces AFTER the
    // verb and is a subject, never an object ("Aqui só existe o vento").
    // `chegar`/`vir`/`aparecer` join them for the inverted arrivals literary
    // prose leans on ("Chegou o inverno", "Veio a noite").
    { lemma: "existir", frame: "presentational" },
    { lemma: "haver", frame: "presentational" },
    { lemma: "faltar", frame: "presentational" },
    { lemma: "sobrar", frame: "presentational" },
    { lemma: "acontecer", frame: "presentational" },
    { lemma: "surgir", frame: "presentational" },
    { lemma: "restar", frame: "presentational" },
    { lemma: "aparecer", frame: "presentational" },
    { lemma: "bastar", frame: "presentational" },
    { lemma: "chegar", frame: "presentational" },
    { lemma: "vir", frame: "presentational" },
  ],
  // `se` also introduces complements ("vim ver se..."), but it is ambiguous
  // with the reflexive clitic, so only the unambiguous `que` is declared.
  complementizers: ["que"],
  relativePronouns: ["que", "quem"],
  relativePlaceAdverbs: ["onde"],
  genitiveMarkers: ["de", "do", "da", "dos", "das"],
  // `estar` + particípio is stative-passive ("estava coberto de neve") and
  // takes the same agent PP when one appears, so it rides along with `ser`.
  // `ir` is here for the homograph, not the grammar: `foi/fora/fosse` resolve
  // to EITHER lemma and the tagger may pick `ir` — before a participle the
  // surface is the ser-passive regardless of which lemma won.
  passiveAuxiliaries: ["ser", "estar", "ir"],
  agentMarkers: ["por", "pelo", "pela", "pelos", "pelas"],
  // Portuguese existentials need no dummy subject (pro-drop) — the inversion
  // is licensed by the presentational frame instead, so no expletives exist.
  expletives: [],
  // Verbs of saying: dialogue attribution puts the sayer AFTER them ("— Não
  // ligue, disse Rei", "argumentava Daniela"), the standard literary form.
  // Curated to verbs whose postverbal person is near-certainly the inverted
  // speaker: perception/contact verbs that take a person as OBJECT (ver,
  // observar, interromper, chamar) are deliberately absent.
  dicendi: [
    "dizer", "falar", "perguntar", "responder", "retrucar", "replicar",
    "exclamar", "gritar", "berrar", "murmurar", "sussurrar", "resmungar",
    "gemer", "suspirar", "insistir", "repetir", "argumentar", "afirmar",
    "comentar", "explicar", "acrescentar", "concluir", "ponderar", "indagar",
    "pensar", "refletir",
  ],
  // `para` covers the analytic dative ("deu o livro para Maria"); the a-family
  // contractions cover the classical one ("entregou o caderno ao sacerdote").
  dativeMarkers: ["a", "ao", "à", "aos", "às", "para"],
  // Only the words that negate the VERB they precede; `sem` negates its own
  // PP/infinitive and stays out.
  negators: ["não", "nunca", "jamais", "nem"],
  anaphoricPronouns: [
    { form: "ele", feat: "ms" },
    { form: "ela", feat: "fs" },
    { form: "eles", feat: "mp" },
    { form: "elas", feat: "fp" },
  ],
  possessivePronouns: ["seu", "sua", "seus", "suas"],
  // The unambiguous proclitic/enclitic object pronouns plus the enclitic
  // allomorphs the hyphen split produces. Bare `o/a/os/as` are deliberately
  // absent: as proclitics they are surface-identical to the articles and the
  // article reading dominates prose.
  accusativeClitics: ["me", "te", "nos", "vos", "lo", "la", "los", "las"],
  dativeClitics: ["me", "te", "lhe", "nos", "vos", "lhes"],
  reflexiveClitics: ["se"],
  // All already in the closed conjunction list; this list marks which of them
  // open an ADVERBIAL clause that attaches to the matrix verb. `se` is
  // conditional here and reflexive above — the binder disambiguates by
  // position (a clitic `se` rides directly against its verb).
  subordinators: ["quando", "enquanto", "porque", "embora", "caso", "conforme", "mal", "se"],
  possessiveRelatives: ["cujo", "cuja", "cujos", "cujas"],
  definiteArticles: ["o", "a", "os", "as"],
  indefiniteArticles: ["um", "uma", "uns", "umas"],
  temporalNouns: [
    "noite", "dia", "manhã", "tarde", "madrugada", "momento", "instante",
    "hora", "vez", "tempo", "ano", "mês", "semana", "verão", "inverno",
    "primavera", "outono", "véspera", "infância", "domingo", "sábado",
  ],
  // Portuguese has no verb-particle construction.
  particles: [],
  degreeAdverbs: ["mais", "menos", "tão"],
  // `do que` reaches the standard through the `que` after the contraction.
  thanMarkers: ["que"],
  // DELAF tense letters: P/I/J/F/Q presente..mais-que-perfeito, C condicional,
  // S/T/U subjuntivos, Y imperativo; W infinitivo (W1s.. pessoal); K particípio;
  // G gerúndio (the progressive/manner chains: `estava correndo`, `saiu correndo`).
  verbFeats: {
    finitePrefixes: ["P", "I", "J", "F", "Q", "C", "S", "T", "U", "Y"],
    infinitivePrefixes: ["W"],
    participlePrefixes: ["K"],
    gerundPrefixes: ["G"],
    // Presente, perfeito, futuro-do-presente and imperativo distinguish 1s/3s
    // (falo/fala, falei/falou, falarei/falará); imperfeito (I), mais-que-
    // perfeito (Q), condicional (C) and the subjuntivos (S/T/U) do NOT — and
    // this DELAF often labels those shared forms `1s` only (`esperava,I1s`
    // with no I3s line), so their person digit is noise.
    personDistinctPrefixes: ["P", "J", "F", "Y"],
  },
}
