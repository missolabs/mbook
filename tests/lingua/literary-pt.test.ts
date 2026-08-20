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
import { verbTense } from "../../src/shared/lingua/model"
import { analyzeParagraph } from "../../src/shared/lingua/pipeline"
import type { ParagraphAnalysis, Sentence } from "../../src/shared/lingua/pipeline"
import type { Relation, RelationKind } from "../../src/shared/lingua/binder"

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

describe("Mishima: a preposition or clitic wants the infinitive, not the subjunctive homograph", () => {
  it("reads `sem mover` as the infinitive and chains it onto the smile", () => {
    const sentence = only("Yuriko sorriu sem mover os olhos.")

    expect(tagged(sentence, "mover").feat).toBe("W")
    expect(relation(sentence, "complement-of", "mover", "sorriu")).toBeDefined()
    expect(relation(sentence, "object-of", "olhos", "mover")).toBeDefined()
  })

  it("reads the clitic shape `se despedir` the same way", () => {
    const sentence = only("Ela desligou sem se despedir.")

    expect(tagged(sentence, "despedir").feat).toBe("W")
    expect(relation(sentence, "complement-of", "despedir", "desligou")).toBeDefined()
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

describe("Murakami: which stairs, from where — genitive nesting and place relatives", () => {
  it("nests a genitive PP under the preceding PP's head, not the verb", () => {
    const sentence = only("Kumiko desceu ao fundo do poço.")

    expect(relation(sentence, "modifier-of", "fundo", "desceu")).toBeDefined()
    expect(relation(sentence, "modifier-of", "poço", "fundo")).toBeDefined()
  })

  it("qualifies an object through its genitive chain", () => {
    const sentence = only("O rapaz subiu os degraus do templo.")

    expect(relation(sentence, "object-of", "degraus", "subiu")).toBeDefined()
    expect(relation(sentence, "modifier-of", "templo", "degraus")).toBeDefined()
  })

  it("locates the place relative's subject in the antecedent, climbing the genitive", () => {
    const sentence = only("Minoru olhava o quintal do vizinho, onde um poço de pedra esperava.")

    expect(tagged(sentence, "onde").pos).toBe("ADV")
    expect(relation(sentence, "located-in", "poço", "quintal")).toBeDefined()
    expect(relation(sentence, "modifier-of", "pedra", "poço")).toBeDefined()
  })
})

describe("Dazai: the fixes the memoir demanded", () => {
  it("strips centred-line and emphasis markup before lexing — marks are typesetting, not prose", () => {
    const centred = analyze("-> Antes <-")

    expect(centred.stripped).toBe("Antes")

    const emphatic = analyze("A execução foi **pior** e *mais lenta*.")

    expect(emphatic.stripped).toBe("A execução foi pior e mais lenta.")

    const extract = analyze("> A perfeição é frágil.")

    expect(extract.stripped).toBe("A perfeição é frágil.")
  })

  it("modern orthography resolves — ideia is a noun, not the rare verb idear", () => {
    const sentence = only("A ideia sempre existiu.")

    expect(tagged(sentence, "ideia").pos).toBe("NOUN")
    expect(relation(sentence, "subject-of", "ideia", "existiu")).toBeDefined()
  })

  it("cuts the sentence after a preposition-governed place initial, but never inside a name", () => {
    const place = analyze("Mudei para S. Eu não ligava.")

    expect(place.sentences.length).toBe(2)

    const name = analyze("O velho F. Tanabe chegou.")

    expect(name.sentences.length).toBe(1)
  })

  it("hands a verb its quoted object — the quotes typeset the title, they don't close the clause", () => {
    const sentence = only("Li “Um estudo em Vermelho” naquela noite.")

    expect(relation(sentence, "object-of", "estudo", "Li")).toBeDefined()
  })

  it("carries the subject over a conjunction trailed by adverbs", () => {
    const sentence = only("Eu puxava o meu caderno e sempre escrevia poesias.")

    expect(dependentsOf(sentence, "subject-of", "escrevia")).toEqual(["Eu"])
    expect(relation(sentence, "object-of", "poesias", "escrevia")).toBeDefined()
  })

  it("agreement keeps junk-rare verb homographs nominal — luz baixa, certa estima", () => {
    const light = only("Eu li sob uma luz baixa amarela.")

    expect(tagged(light, "baixa").pos).toBe("ADJ")
    expect(tagged(light, "amarela").pos).toBe("ADJ")

    const esteem = only("Eu tinha certa estima por ele.")

    expect(tagged(esteem, "estima").pos).toBe("NOUN")
    expect(relation(esteem, "object-of", "estima", "tinha")).toBeDefined()
  })

  it("a matrix verb with its own object disowns the que-clause — no relative object minted", () => {
    const sentence = only("Ele conseguia ver nos olhos de Rei que ela ligava.")

    expect(dependentsOf(sentence, "object-of", "ligava")).toEqual([])
  })

  it("the free relative is the object itself — o que eu fiz elides nothing", () => {
    const sentence = only("Ele sabia o que eu tinha feito.")

    expect(relation(sentence, "object-of", "que", "feito")).toBeDefined()
  })

  it("foi resolves to the copula among its homographs — Foi um tempo predicates", () => {
    const sentence = only("Foi um tempo de silêncio.")

    expect(tagged(sentence, "Foi").lemma).toBe("ser")
    expect(relation(sentence, "predicate-of", "tempo", "Foi")).toBeDefined()
  })

  it("a subjectless third-person verb continues the subject on stage", () => {
    const analysis = analyze("Rei chegou cansado. Sentou na cadeira.")

    const subjects = analysis.discourse.filter((d) => d.kind === "elided-subject")

    expect(subjects.length).toBe(1)
    expect(subjects[0]!.fromSentence).toBe(1)
    expect(subjects[0]!.toSentence).toBe(0)
  })

  it("never guesses a subject for the first person or the impersonal", () => {
    const firstPerson = analyze("Rei chegou cansado. Cheguei logo depois.")

    expect(firstPerson.discourse.filter((d) => d.kind === "elided-subject")).toEqual([])

    const impersonal = analyze("Rei chegou cansado. Havia gelo na estrada.")

    expect(impersonal.discourse.filter((d) => d.kind === "elided-subject")).toEqual([])
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

  it("keeps the question's own subject and object, and hands the attribution its pronoun sayer", () => {
    const sentence = analysis.sentences[0]!

    expect(relation(sentence, "subject-of", "Você", "viu")).toBeDefined()
    expect(relation(sentence, "object-of", "mar", "viu")).toBeDefined()

    // The VP rule swallows `perguntou ela` into one chunk; the quotative
    // inversion now reads the swallowed pronoun as the inverted sayer.
    expect(dependentsOf(sentence, "subject-of", "perguntou")).toEqual(["ela"])
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

describe("dialogue attribution: the sayer stands after the verb", () => {
  it("inverts the attribution tail — the postverbal name is the subject, not what was said", () => {
    const analysis = analyze("Um dos meus maiores defeitos era ligar para as pessoas, dizia Kirie.")

    expect(analysis.sentences.length).toBe(1)

    const sentence = analysis.sentences[0]!

    expect(dependentsOf(sentence, "subject-of", "dizia")).toEqual(["Kirie"])
    expect(dependentsOf(sentence, "object-of", "dizia")).toEqual([])

    // The quote IS the content: an inverted dicendi verb elides nothing.
    expect(analysis.discourse).toEqual([])
  })

  it("sees through a free relative to the inverted sayer", () => {
    const sentence = only("Ao menos era o que argumentava Kirie.")

    expect(dependentsOf(sentence, "subject-of", "argumentava")).toEqual(["Kirie"])
    expect(dependentsOf(sentence, "object-of", "argumentava")).toEqual([])
  })

  it("leaves the plain SVO reading alone — a clause-mate subject blocks the inversion", () => {
    const sentence = only("Kumiko dizia mentiras naquela noite.")

    expect(dependentsOf(sentence, "subject-of", "dizia")).toEqual(["Kumiko"])
    expect(relation(sentence, "object-of", "mentiras", "dizia")).toBeDefined()
  })

  it("never steals a name out of an embedded clause — the complementizer wins", () => {
    const sentence = only("Mizoguchi disse que Kirie partiu.")

    expect(dependentsOf(sentence, "subject-of", "disse")).toEqual(["Mizoguchi"])
    expect(relation(sentence, "complement-of", "que", "disse")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "partiu")).toEqual(["Kirie"])
  })
})

describe("the passive agent who is a bare name", () => {
  it("binds por + proper noun to a passive participle as its agent, not its object", () => {
    const sentence = only("A estima não era compartilhada por Kirie.")

    expect(relation(sentence, "agent-of", "Kirie", "compartilhada")).toBeDefined()
    expect(dependentsOf(sentence, "object-of", "compartilhada")).toEqual([])
  })

  it("keeps the appositive nominal a noun — the subject-verb bigram dies at the comma", () => {
    const sentence = only("Eu tinha certa estima por S, coisa que não era compartilhada por Kirie.")

    expect(tagged(sentence, "coisa").pos).toBe("NOUN")
    expect(relation(sentence, "agent-of", "Kirie", "compartilhada")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "compartilhada")).toEqual(["coisa"])
  })

  it("keeps the com-companion an object — only agent markers reroute", () => {
    const sentence = only("Encontrei com Kirie no mercado.")

    expect(relation(sentence, "object-of", "Kirie", "Encontrei")).toBeDefined()
  })
})

describe("argument structure: datives, obliques and clitics", () => {
  it("binds the ditransitive's recipient — analytic and contracted", () => {
    const gave = only("Deu a garrafa a Daniela.")

    expect(relation(gave, "object-of", "garrafa", "Deu")).toBeDefined()
    expect(relation(gave, "dative-of", "Daniela", "Deu")).toBeDefined()

    const handed = only("Entregou o caderno ao sacerdote.")

    expect(relation(handed, "object-of", "caderno", "Entregou")).toBeDefined()
    expect(relation(handed, "dative-of", "sacerdote", "Entregou")).toBeDefined()
  })

  it("a prepositional-frame verb GOVERNS its argument, even a bare name", () => {
    const sentence = only("Gostava da Daniela.")

    expect(relation(sentence, "oblique-of", "Daniela", "Gostava")).toBeDefined()
  })

  it("an accusative clitic riding the verb is its object", () => {
    const sentence = only("Ele me encontrou no mercado.")

    expect(relation(sentence, "object-of", "me", "encontrou")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "encontrou")).toEqual(["Ele"])
  })

  it("a dative clitic on a ditransitive is its recipient", () => {
    const sentence = only("Ele disse-me a verdade.")

    expect(relation(sentence, "dative-of", "me", "disse")).toBeDefined()
    expect(relation(sentence, "object-of", "verdade", "disse")).toBeDefined()
  })

  it("reaches the pied-piped relative's antecedent through the preposition", () => {
    const sentence = only("A casa em que morei ficava longe.")

    expect(relation(sentence, "oblique-of", "casa", "morei")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "ficava")).toEqual(["casa"])
  })
})

describe("the three grammars of se", () => {
  it("reads the se-passive's postverbal NP as its subject", () => {
    const sentence = only("Vendem-se casas.")

    expect(tagged(sentence, "casas").pos).toBe("NOUN")
    expect(relation(sentence, "subject-of", "casas", "Vendem")).toBeDefined()
    expect(relation(sentence, "reflexive-of", "se", "Vendem")).toBeDefined()
  })

  it("marks the reflexive and elides nothing", () => {
    const analysis = analyze("Ela se abraçou.")
    const sentence = analysis.sentences[0]!

    expect(relation(sentence, "reflexive-of", "se", "abraçou")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "abraçou")).toEqual(["Ela"])
    expect(analysis.discourse).toEqual([])
  })

  it("keeps the conditional se a subordinator, not a clitic", () => {
    const sentence = only("Se a noite caísse, Rei sairia.")

    expect(sentence.relations.filter((r) => r.kind === "reflexive-of")).toEqual([])
    expect(relation(sentence, "adverbial-of", "Se", "sairia")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "sairia")).toEqual(["Rei"])
  })
})

describe("predicates, chains and polarity", () => {
  it("a copula's PP is its predicate, not a plain modifier", () => {
    const sentence = only("Rei estava no bar.")

    expect(relation(sentence, "predicate-of", "bar", "estava")).toBeDefined()
  })

  it("chains the gerund onto the progressive auxiliary", () => {
    const sentence = only("Estava correndo pela rua.")

    expect(relation(sentence, "complement-of", "correndo", "Estava")).toBeDefined()
  })

  it("a negator riding the verb flips its relations' polarity", () => {
    const sentence = only("Rei não abriu a porta.")

    expect(relation(sentence, "object-of", "porta", "abriu").polarity).toBe("negative")
    expect(relation(sentence, "subject-of", "Rei", "abriu").polarity).toBe("negative")
  })

  it("the flip follows the passive chain onto the participle", () => {
    const sentence = only("A estima não era compartilhada por Kirie.")

    expect(relation(sentence, "agent-of", "Kirie", "compartilhada").polarity).toBe("negative")
  })

  it("an affirmative clause stays affirmative", () => {
    const sentence = only("Rei abriu a porta.")

    expect(relation(sentence, "object-of", "porta", "abriu").polarity).toBe("affirmative")
  })
})

describe("comparatives, time and subordinate clauses", () => {
  it("finds the comparative's standard past the than-marker", () => {
    const sentence = only("Kumiko era mais alta que Kirie.")

    expect(tagged(sentence, "alta").pos).toBe("ADJ")
    expect(relation(sentence, "predicate-of", "alta", "era")).toBeDefined()
    expect(relation(sentence, "compared-to", "Kirie", "alta")).toBeDefined()
  })

  it("a time-naming adjunct frames the event, past a nearer nominal", () => {
    const sentence = only("Li o caderno naquela noite.")

    expect(relation(sentence, "temporal-of", "noite", "Li")).toBeDefined()
  })

  it("a sentence-opening time NP frames the clause ahead", () => {
    const sentence = only("Uma vez, encontrei Daniela no mercado.")

    expect(relation(sentence, "temporal-of", "vez", "encontrei")).toBeDefined()
  })

  it("attaches an adverbial clause to its matrix verb, both orders", () => {
    const trailing = only("Chorou quando o gato sumiu.")

    expect(relation(trailing, "adverbial-of", "quando", "Chorou")).toBeDefined()
    expect(dependentsOf(trailing, "subject-of", "sumiu")).toEqual(["gato"])

    const leading = only("Quando a noite caiu, Rei saiu.")

    expect(relation(leading, "adverbial-of", "Quando", "saiu")).toBeDefined()
    expect(dependentsOf(leading, "subject-of", "caiu")).toEqual(["noite"])
  })
})

describe("relatives, questions and address", () => {
  it("the possessive relative hands the noun to its owner — and the matrix verb too", () => {
    const sentence = only("O homem cujo gato sumiu chorava.")

    expect(relation(sentence, "modifier-of", "homem", "gato")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "sumiu")).toEqual(["gato"])
    expect(dependentsOf(sentence, "subject-of", "chorava")).toEqual(["homem"])
  })

  it("recovers the fronted interrogative object", () => {
    const what = only("O que ele viu?")

    expect(relation(what, "object-of", "que", "viu")).toBeDefined()

    const who = only("Quem ele viu?")

    expect(relation(who, "object-of", "Quem", "viu")).toBeDefined()
  })

  it("reads the addressed name as vocative, never as a first-person verb's subject", () => {
    const leading = only("Daniela, acho que você exagera.")

    expect(relation(leading, "vocative-of", "Daniela", "acho")).toBeDefined()
    expect(dependentsOf(leading, "subject-of", "acho")).toEqual([])

    const trailing = only("Não chore, Daniela.")

    expect(relation(trailing, "vocative-of", "Daniela", "chore")).toBeDefined()
  })

  it("shares a right-node-raised object back across the conjunction", () => {
    const sentence = only("Comprou e leu o caderno.")

    expect(relation(sentence, "object-of", "caderno", "leu")).toBeDefined()
    expect(relation(sentence, "object-of", "caderno", "Comprou")).toBeDefined()
  })

  it("an indefinite comma-NP renames the name before it", () => {
    const sentence = only("Encontrei Daniela, uma mulher de poucas palavras.")

    expect(relation(sentence, "appositive-of", "mulher", "Daniela")).toBeDefined()
  })

  it("hands the inverted attribution its quote as complement", () => {
    const sentence = only("Um dos meus maiores defeitos era ligar demais, dizia Rei.")

    expect(dependentsOf(sentence, "subject-of", "dizia")).toEqual(["Rei"])
    expect(relation(sentence, "complement-of", "Um", "dizia")).toBeDefined()
  })
})

describe("discourse: pronouns find their people, articles their entities", () => {
  function link(text: string, kind: string) {
    return analyze(text).discourse.filter((d) => d.kind === kind)
  }

  function word(text: string, sentence: number, token: number): string {
    const s = analyze(text).sentences[sentence]!
    const t = s.tokens[token]!

    switch (t.role) {
      case "content":
        return t.tagged.token.text
      case "punctuation":
        return t.token.text
    }
  }

  it("a pronoun prefers the agreeing SUBJECT over a nearer oblique noun", () => {
    const text = "Mizoguchi olhava o poço em silêncio. Ele parecia cansado."
    const links = link(text, "anaphora")

    expect(links.length).toBe(1)
    expect(word(text, links[0]!.toSentence, links[0]!.toToken)).toBe("Mizoguchi")
  })

  it("gender agreement picks the right person", () => {
    const text = "Kirie chorava no mercado. Ela segurava a bolsa."
    const links = link(text, "anaphora")

    expect(links.length).toBe(1)
    expect(word(text, links[0]!.toSentence, links[0]!.toToken)).toBe("Kirie")
  })

  it("a possessive binds to the nearest subject — whose notebook it is", () => {
    const text = "Kirie chegou cedo. Ela segurava o seu caderno."
    const links = link(text, "anaphora")

    const possessive = links.find((d) => word(text, d.fromSentence, d.fromToken) === "seu")!

    expect(possessive).toBeDefined()
    expect(word(text, possessive.toSentence, possessive.toToken)).toBe("Ela")
  })

  it("a definite NP resumes the entity its indefinite introduced", () => {
    const text = "Havia um poço no quintal. O poço estava seco."
    const links = link(text, "coreference")

    expect(links.length).toBe(1)
    expect(links[0]!.fromSentence).toBe(1)
    expect(links[0]!.toSentence).toBe(0)
    expect(word(text, links[0]!.toSentence, links[0]!.toToken)).toBe("poço")
  })

  it("a definite NP with no introduction claims nothing", () => {
    expect(link("O poço estava seco.", "coreference")).toEqual([])
  })

  it("the dictionary's diminutive lemma carries coreference — o gatinho IS o gato", () => {
    const text = "Havia um gato no quintal. O gatinho dormia."
    const links = link(text, "coreference")

    expect(links.length).toBe(1)
    expect(word(text, links[0]!.fromSentence, links[0]!.fromToken)).toBe("gatinho")
    expect(word(text, links[0]!.toSentence, links[0]!.toToken)).toBe("gato")
  })

  it("the article-shaped clitic is an object and an anaphor — never the plain article", () => {
    const text = "Mizoguchi chegou cedo. Eu o vi no mercado."
    const analysis = analyze(text)
    const second = analysis.sentences[1]!

    expect(relation(second, "object-of", "o", "vi")).toBeDefined()

    const links = analysis.discourse.filter((d) => d.kind === "anaphora")

    expect(links.length).toBe(1)
    expect(word(text, links[0]!.toSentence, links[0]!.toToken)).toBe("Mizoguchi")

    // The plain article inside an NP claims nothing.
    const article = analyze("O vento uivava na praia.")

    expect(article.sentences[0]!.relations.filter((r) => r.kind === "object-of")).toEqual([])
    expect(article.discourse.filter((d) => d.kind === "anaphora")).toEqual([])
  })
})

describe("light verbs, tense senses and the name shape", () => {
  it("marks the verb+noun pair as one event", () => {
    const sentence = only("Deu um passeio no quintal.")

    expect(relation(sentence, "object-of", "passeio", "Deu")).toBeDefined()
    expect(relation(sentence, "light-verb-of", "passeio", "Deu")).toBeDefined()
  })

  it("an unlisted pair stays a plain object", () => {
    const sentence = only("Deu a garrafa a Daniela.")

    expect(sentence.relations.filter((r) => r.kind === "light-verb-of")).toEqual([])
  })

  it("classifies verb feats onto the timeline", () => {
    const marks = PT.syntax.verbFeats

    expect(verbTense("I3s", marks)).toEqual({ kind: "some", value: "imperfect" })
    expect(verbTense("J1s", marks)).toEqual({ kind: "some", value: "past" })
    expect(verbTense("Kfs", marks)).toEqual({ kind: "some", value: "participle" })
    expect(verbTense("G", marks)).toEqual({ kind: "some", value: "gerund" })
    expect(verbTense("zz", marks)).toEqual({ kind: "none" })
  })

  it("a capitalized unknown after a name is the name's continuation, not an -ar verb", () => {
    const sentence = only("Fiquei no B Bar.")

    expect(tagged(sentence, "Bar").pos).toBe("PROPN")
  })
})

describe("the timeline: deterministic event ordering", () => {
  function edgeWords(text: string) {
    const analysis = analyze(text)

    const at = (si: number, ti: number): string => {
      const t = analysis.sentences[si]!.tokens[ti]!

      switch (t.role) {
        case "content":
          return t.tagged.token.text
        case "punctuation":
          return t.token.text
      }
    }

    return analysis.timeline.edges.map(
      (e) => `${e.kind}:${at(e.fromSentence, e.fromToken)}->${at(e.toSentence, e.toToken)}:${e.provenance}`,
    )
  }

  function lanes(text: string) {
    const analysis = analyze(text)

    const at = (si: number, ti: number): string => {
      const t = analysis.sentences[si]!.tokens[ti]!

      switch (t.role) {
        case "content":
          return t.tagged.token.text
        case "punctuation":
          return t.token.text
      }
    }

    return analysis.timeline.events.map((e) => `${at(e.sentence, e.token)}:${e.lane}`)
  }

  it("successive perfectives chain — the narrative convention", () => {
    expect(edgeWords("Rei chegou ao bar. Sentou na cadeira. Abriu o caderno.")).toEqual([
      "before:chegou->Sentou:narrative-advance",
      "before:Sentou->Abriu:narrative-advance",
    ])
  })

  it("an imperfective is background the event happens INSIDE", () => {
    expect(edgeWords("Chovia naquela noite. Rei entrou no bar.")).toEqual([
      "during:entrou->Chovia:tense-anaphora",
    ])
  })

  it("the perfect chain is a flashback — before the reference, advancing nothing", () => {
    expect(edgeWords("Rei chegou cansado. Tinha perdido o gato.")).toEqual([
      "before:perdido->chegou:tense-anaphora",
    ])
  })

  it("a temporal subordinator orders its clause and keeps it OFF the chain", () => {
    expect(edgeWords("Chorou quando o gato sumiu.")).toEqual(["meets:sumiu->Chorou:connective"])
  })

  it("a retreat adverb flips the sentence backward", () => {
    expect(edgeWords("Rei abriu a porta. Antes, fechou a janela.")).toEqual([
      "before:fechou->abriu:connective",
    ])
  })

  it("negation, present commentary and subjunctives never order anything", () => {
    const text = "Rei não abriu a porta. Acho que talvez chovesse."

    expect(lanes(text)).toEqual(["abriu:negated", "Acho:offline", "chovesse:irrealis"])
    expect(edgeWords(text)).toEqual([])
  })

  it("speech lives on its own lane", () => {
    const analysis = analyze("— Rei abriu a porta e fugiu!")

    expect(analysis.timeline.events.length).toBeGreaterThan(0)

    for (const event of analysis.timeline.events) {
      expect(event.lane).toBe("speech")
    }

    expect(analysis.timeline.edges).toEqual([])
  })
})
