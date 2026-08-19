// The Portuguese literary corpus: original passages written in the voice of
// the house's shelf — Mishima (the golden pavilion, beauty as sentence),
// Dazai (the confessional pro-drop first person), Murakami (wells, cats,
// telephones, spaghetti) and Junji Ito (the spiral) — each pinning a distinct
// grammar behavior end-to-end through analyzeParagraph.

import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { scanLine } from "../../src/shared/book/glyphs"
import type { Cast } from "../../src/shared/book/cast"
import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Lexicon } from "../../src/shared/lingua/lexicon"
import { analyzeParagraph } from "../../src/shared/lingua/analysis"
import type { ParagraphAnalysis, Sentence } from "../../src/shared/lingua/analysis"
import type { Relation, RelationKind } from "../../src/shared/lingua/relations"

const DICT_DIR = join(import.meta.dir, "../../resources/dictionaries")

function open(lang: string): Lexicon {
  const buffer = readFileSync(join(DICT_DIR, `${lang}.dict`))
  const opened = openLexicon(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))

  switch (opened.ok) {
    case false:
      throw new Error(`open ${lang}: ${opened.error.kind}`)
    case true:
      return opened.value
  }
}

const PT = open("pt-BR")

const CAST: Cast = {
  characters: [
    { name: "Mizoguchi", slug: "mizoguchi" },
    { name: "Kumiko", slug: "kumiko" },
    { name: "Kirie", slug: "kirie" },
  ],
}

function analyze(text: string): ParagraphAnalysis {
  return analyzeParagraph({ text, spans: scanLine(text, CAST), lexicon: PT, language: { kind: "pt-BR" } })
}

function only(text: string): Sentence {
  const analysis = analyze(text)

  expect(analysis.sentences.length).toBe(1)

  return analysis.sentences[0]!
}

function textAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.token.text
    case "punctuation":
      return token.token.text
  }
}

function tagged(sentence: Sentence, text: string) {
  for (const token of sentence.tokens) {
    switch (token.role) {
      case "content":
        break
      case "punctuation":
        continue
    }

    switch (token.tagged.token.text === text) {
      case true:
        return token.tagged
      case false:
        continue
    }
  }

  throw new Error(`no token "${text}"`)
}

function relation(sentence: Sentence, kind: RelationKind, depText: string, headText: string): Relation {
  const hit = sentence.relations.find(
    (r) => r.kind === kind && textAt(sentence, r.dependent) === depText && textAt(sentence, r.head) === headText,
  )

  switch (hit === undefined) {
    case true:
      throw new Error(`no ${kind}(${depText}->${headText}) in ${describeRelations(sentence)}`)
    case false:
      return hit!
  }
}

function describeRelations(sentence: Sentence): string {
  return JSON.stringify(
    sentence.relations.map((r) => `${r.kind}:${textAt(sentence, r.dependent)}->${textAt(sentence, r.head)}`),
  )
}

function dependentsOf(sentence: Sentence, kind: RelationKind, headText: string): string[] {
  return sentence.relations
    .filter((r) => r.kind === kind && textAt(sentence, r.head) === headText)
    .map((r) => textAt(sentence, r.dependent))
}

describe("Mishima: the pavilion burns — the full passive periphrasis", () => {
  const sentence = only("O Pavilhão Dourado foi destruído pelo fogo.")

  it("resolves the ambiguous auxiliary and the participle to their lemmas", () => {
    expect(tagged(sentence, "destruído").lemma).toBe("destruir")
    expect(tagged(sentence, "destruído").feat.startsWith("K")).toBe(true)
  })

  it("keeps the patient as subject of both auxiliary and participle", () => {
    expect(dependentsOf(sentence, "subject-of", "foi")).toEqual(["Pavilhão"])
    expect(dependentsOf(sentence, "subject-of", "destruído")).toEqual(["Pavilhão"])
  })

  it("chains the participle onto the auxiliary as its complement", () => {
    expect(relation(sentence, "complement-of", "destruído", "foi")).toBeDefined()
  })

  it("reads the por-phrase as the agent, not a plain modifier, and claims no object", () => {
    expect(relation(sentence, "agent-of", "fogo", "destruído")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
    expect(sentence.relations.filter((r) => r.kind === "modifier-of")).toEqual([])
  })
})

describe("Mishima: beauty was a sentence — copular predicates", () => {
  it("links the postverbal NP to the copula as its predicate", () => {
    const sentence = only("A beleza era uma sentença.")

    expect(relation(sentence, "subject-of", "beleza", "era")).toBeDefined()
    expect(relation(sentence, "predicate-of", "sentença", "era")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })

  it("predicates a bare postverbal word across estar too", () => {
    const sentence = only("O mar estava calmo.")

    expect(relation(sentence, "predicate-of", "calmo", "estava")).toBeDefined()
  })

  it("keeps predicating without a surface subject — the pro-drop confession", () => {
    const sentence = only("Sou um homem cheio de vergonha.")

    expect(tagged(sentence, "Sou").lemma).toBe("ser")
    expect(dependentsOf(sentence, "predicate-of", "Sou").length).toBe(1)
    expect(sentence.relations.filter((r) => r.kind === "subject-of")).toEqual([])
  })
})

describe("Mishima: the confiscated notebook — an OBJECT relative resolves too", () => {
  it("hands the embedded verb its antecedent as object, alongside the matrix object", () => {
    const sentence = only("Kenzō guardou o caderno que o monge confiscara.")

    expect(relation(sentence, "object-of", "caderno", "guardou")).toBeDefined()
    expect(relation(sentence, "object-of", "caderno", "confiscara")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "confiscara")).toEqual(["monge"])
  })

  it("hops the appositive comma to reach the antecedent", () => {
    const sentence = only("Maria, que o monge amava, partiu.")

    expect(relation(sentence, "object-of", "Maria", "amava")).toBeDefined()
  })

  it("claims no object in a SUBJECT relative — nothing stands between pronoun and verb", () => {
    const sentence = only("O homem que comeu dormiu.")

    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("Mishima: the stuttering monk — a relative clause defers to its antecedent", () => {
  const sentence = only("O monge que gaguejava contemplava o templo.")

  it("subjects the antecedent, not the pronoun, to the embedded verb", () => {
    expect(dependentsOf(sentence, "subject-of", "gaguejava")).toEqual(["monge"])
  })

  it("carries the same antecedent to the matrix verb and finds its object", () => {
    expect(dependentsOf(sentence, "subject-of", "contemplava")).toEqual(["monge"])
    expect(relation(sentence, "object-of", "templo", "contemplava")).toBeDefined()
  })
})

describe("Dazai: the confessional pro-drop clause opens on the verb", () => {
  it("reads a sentence-initial first-person verb as the verb, with its object and no subject", () => {
    const sentence = only("Escrevi três cadernos de memórias.")

    expect(tagged(sentence, "Escrevi").pos).toBe("VERB")
    expect(tagged(sentence, "Escrevi").lemma).toBe("escrever")
    expect(relation(sentence, "object-of", "cadernos", "Escrevi")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "subject-of")).toEqual([])
  })

  it("finds the verb behind the negation and keeps its object", () => {
    const sentence = only("Não sabia a resposta.")

    expect(tagged(sentence, "Não").pos).toBe("ADV")
    expect(tagged(sentence, "sabia").lemma).toBe("saber")
    expect(relation(sentence, "object-of", "resposta", "sabia")).toBeDefined()
  })

  it("shares one lost verb across coordinated objects — shame and fear alike", () => {
    const sentence = only("Perdi a vergonha e o medo.")

    expect(dependentsOf(sentence, "object-of", "Perdi").sort()).toEqual(["medo", "vergonha"])
  })

  it("predicates over an infinitive subject — envelhecer é uma cerimônia cruel", () => {
    const sentence = only("Envelhecer é uma cerimônia cruel.")

    expect(relation(sentence, "predicate-of", "cerimônia", "é")).toBeDefined()
    expect(relation(sentence, "modifier-of", "cruel", "cerimônia")).toBeDefined()
  })
})

describe("Murakami: hyphen compounds survive the clitic split", () => {
  it("keeps quinta-feira one token with its own lemma, inside a PP", () => {
    const sentence = only("Na quinta-feira, o telefone tocou.")

    expect(tagged(sentence, "quinta-feira").pos).toBe("NOUN")
    expect(tagged(sentence, "quinta-feira").lemma).toBe("quinta-feira")
    expect(dependentsOf(sentence, "subject-of", "tocou")).toEqual(["telefone"])
  })

  it("never mistakes the weekday for a verb's object", () => {
    const sentence = only("O gato desapareceu na terça-feira.")

    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
    expect(relation(sentence, "modifier-of", "terça-feira", "desapareceu")).toBeDefined()
  })

  it("stacks compound time phrases before the clause without stealing the subject", () => {
    const sentence = only("Naquela quinta-feira, à meia-noite, Kumiko desceu ao fundo do poço.")

    expect(tagged(sentence, "meia-noite").lemma).toBe("meia-noite")
    expect(dependentsOf(sentence, "subject-of", "desceu")).toEqual(["Kumiko"])
  })

  it("still splits a true clitic — the lexicon knows no disse-me", () => {
    const sentence = only("Ele disse-me a verdade e saiu.")

    expect(tagged(sentence, "disse").lemma).toBe("dizer")
    expect(tagged(sentence, "me").lemma).toBe("eu")
  })

  it("splits the allomorphic enclitic vê-lo into verb and pronoun", () => {
    const sentence = only("Queria vê-lo morrer.")

    expect(tagged(sentence, "vê").lemma).toBe("ver")
    expect(tagged(sentence, "lo").pos).toBe("PRON")
    expect(tagged(sentence, "lo").lemma).toBe("ele")
  })
})

describe("Murakami: the perfect periphrasis carries the object", () => {
  const sentence = only("Kumiko tinha visto o poço no quintal.")

  it("gives the participle the object and chains it onto ter", () => {
    expect(relation(sentence, "object-of", "poço", "visto")).toBeDefined()
    expect(relation(sentence, "complement-of", "visto", "tinha")).toBeDefined()
  })

  it("keeps the auxiliary objectless and the subject on both verbs", () => {
    expect(dependentsOf(sentence, "object-of", "tinha")).toEqual([])
    expect(dependentsOf(sentence, "subject-of", "tinha")).toEqual(["Kumiko"])
    expect(dependentsOf(sentence, "subject-of", "visto")).toEqual(["Kumiko"])
  })
})

describe("Murakami: an elided object resolves through the perfect", () => {
  const analysis = analyze("O pão sumiu. Ela tinha comido.")

  it("links comido back to pão — she had eaten it", () => {
    expect(analysis.discourse.length).toBe(1)

    const link = analysis.discourse[0]!

    expect(link.fromSentence).toBe(1)
    expect(link.toSentence).toBe(0)
  })
})

describe("Murakami: seasons arrive verb-first", () => {
  it("makes the postverbal NP the subject of chegar", () => {
    const sentence = only("Chegou o inverno.")

    expect(relation(sentence, "subject-of", "inverno", "Chegou")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })

  it("makes the night the subject of vir", () => {
    const sentence = only("Veio a noite.")

    expect(relation(sentence, "subject-of", "noite", "Veio")).toBeDefined()
  })
})

describe("Ito: the spiral surfaces", () => {
  it("inverts the unaccusative surgir onto its postverbal subject", () => {
    const sentence = only("Surgiu uma espiral no tanque do vizinho.")

    expect(relation(sentence, "subject-of", "espiral", "Surgiu")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })

  it("names the spiral the agent of the taken city", () => {
    const sentence = only("A cidade foi tomada pela espiral.")

    expect(relation(sentence, "agent-of", "espiral", "tomada")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "tomada")).toEqual(["cidade"])
  })

  it("spreads a pinned subject across the coordination — Kirie pinned, the brother inferred", () => {
    const sentence = only("@[Kirie] e o irmão viram a espiral no tanque.")

    const kirie = relation(sentence, "subject-of", "Kirie", "viram")
    const brother = relation(sentence, "subject-of", "irmão", "viram")

    expect(kirie.provenance).toBe("pinned")
    expect(brother.provenance).toBe("heuristic")
    expect(relation(sentence, "object-of", "espiral", "viram")).toBeDefined()
  })
})

describe("Ito: a passive is a construction, not an ellipsis", () => {
  const analysis = analyze("O gato pegou o peixe. O peixe foi comido.")

  it("builds no discourse link for the passive participle of comer", () => {
    expect(analysis.discourse).toEqual([])
  })
})

describe("dialogue: the travessão attribution stays one sentence", () => {
  const analysis = analyze("— Você viu o mar? — perguntou ela.")

  it("keeps question and attribution together as speech", () => {
    expect(analysis.sentences.length).toBe(1)
    expect(analysis.sentences[0]!.attribution.kind).toBe("speech")
  })

  it("keeps the question's own subject and object, and starves the attribution verb", () => {
    const sentence = analysis.sentences[0]!

    expect(relation(sentence, "subject-of", "Você", "viu")).toBeDefined()
    expect(relation(sentence, "object-of", "mar", "viu")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "perguntou")).toEqual([])
  })
})

describe("segmentation: hesitation and initials never cut", () => {
  it("carries an ellipsis hesitation into one sentence and finds the complement", () => {
    const sentence = only("Bem… acho que sim.")

    expect(relation(sentence, "complement-of", "que", "acho")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "acho")).toEqual([])
  })

  it("reads a name initial as an initial, not a sentence end", () => {
    const sentence = only("O velho F. Tanabe chegou à meia-noite.")

    expect(dependentsOf(sentence, "subject-of", "chegou")).toEqual(["Tanabe"])
  })
})

describe("coordination: a conjoined verb inherits the clause subject", () => {
  it("never takes the first verb's object as the second verb's subject", () => {
    const sentence = only("Mizoguchi abriu a porta e saiu.")

    expect(dependentsOf(sentence, "subject-of", "abriu")).toEqual(["Mizoguchi"])
    expect(dependentsOf(sentence, "subject-of", "saiu")).toEqual(["Mizoguchi"])
  })

  it("shares the subject and keeps the second verb's own object", () => {
    const sentence = only("A neve caiu e apagou a cidade.")

    expect(dependentsOf(sentence, "subject-of", "caiu")).toEqual(["neve"])
    expect(dependentsOf(sentence, "subject-of", "apagou")).toEqual(["neve"])
    expect(relation(sentence, "object-of", "cidade", "apagou")).toBeDefined()
  })

  it("carries the subject through a clitic-split verb chain", () => {
    const sentence = only("Ele disse-me a verdade e saiu.")

    expect(dependentsOf(sentence, "subject-of", "disse")).toEqual(["Ele"])
    expect(dependentsOf(sentence, "subject-of", "saiu")).toEqual(["Ele"])
    expect(relation(sentence, "object-of", "verdade", "disse")).toBeDefined()
  })
})
