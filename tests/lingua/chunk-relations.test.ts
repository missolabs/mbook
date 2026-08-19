import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { scanLine } from "../../src/shared/book/glyphs"
import type { Cast } from "../../src/shared/book/cast"
import { openLexicon } from "../../src/shared/lingua/lexicon"
import type { Lexicon } from "../../src/shared/lingua/lexicon"
import { analyzeParagraph } from "../../src/shared/lingua/analysis"
import type { Sentence } from "../../src/shared/lingua/analysis"
import type { ChunkKind } from "../../src/shared/lingua/model"
import type { Chunk } from "../../src/shared/lingua/chunk"
import type { Relation, RelationKind, RelationProvenance } from "../../src/shared/lingua/relations"
import type { Language } from "../../src/shared/lingua/language"

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
const EN = open("en")

const CAST: Cast = { characters: [{ name: "João", slug: "joao" }, { name: "Maria", slug: "maria" }] }

function only(text: string, lexicon: Lexicon, language: Language): Sentence {
  const analysis = analyzeParagraph({ text, spans: scanLine(text, CAST), lexicon, language })

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

function lemmaAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.lemma
    case "punctuation":
      return ""
  }
}

function posOf(sentence: Sentence, text: string): string {
  for (const token of sentence.tokens) {
    switch (token.role) {
      case "content":
        break
      case "punctuation":
        continue
    }

    switch (token.tagged.token.text === text) {
      case true:
        return token.tagged.pos
      case false:
        continue
    }
  }

  throw new Error(`no token "${text}"`)
}

function objectsOf(sentence: Sentence, verbText: string): string[] {
  return sentence.relations
    .filter((r) => r.kind === "object-of" && textAt(sentence, r.head) === verbText)
    .map((r) => textAt(sentence, r.dependent))
}

// A chunk described by kind and the surface text of its head token.
function chunk(sentence: Sentence, kind: ChunkKind, headText: string): Chunk {
  const hit = sentence.chunks.find((c) => c.kind === kind && textAt(sentence, c.head) === headText)

  switch (hit === undefined) {
    case true:
      throw new Error(`no ${kind} head "${headText}" in ${describeChunks(sentence)}`)
    case false:
      return hit!
  }
}

function describeChunks(sentence: Sentence): string {
  return JSON.stringify(sentence.chunks.map((c) => `${c.kind}:${textAt(sentence, c.head)}`))
}

// A relation described by its endpoints' surface text, so tests never hard-code
// token indices.
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
    sentence.relations.map((r) => `${r.kind}:${textAt(sentence, r.dependent)}->${textAt(sentence, r.head)}(${r.provenance})`),
  )
}

function subjectHeads(sentence: Sentence, verbText: string): string[] {
  return sentence.relations
    .filter((r) => r.kind === "subject-of" && textAt(sentence, r.head) === verbText)
    .map((r) => textAt(sentence, r.dependent))
}

function provenanceOf(relation: Relation): RelationProvenance {
  return relation.provenance
}

describe("pt-BR: shallow chunks and SVO dependencies", () => {
  const sentence = only("O gato comeu o peixe.", PT, { kind: "pt-BR" })

  it("chunks the determiner NPs and the verb group, heading each on the right token", () => {
    const subject = chunk(sentence, "NP", "gato")
    const verb = chunk(sentence, "VP", "comeu")
    const object = chunk(sentence, "NP", "peixe")

    expect(sentence.chunks).toEqual([subject, verb, object])
    expect(lemmaAt(sentence, verb.head)).toBe("comer")
  })

  it("reads subject before the verb and object after, both positional", () => {
    expect(provenanceOf(relation(sentence, "subject-of", "gato", "comeu"))).toBe("heuristic")
    expect(provenanceOf(relation(sentence, "object-of", "peixe", "comeu"))).toBe("heuristic")
  })
})

describe("pt-BR: a bound dialogue line is attributed to its speaker", () => {
  const sentence = only("—[João] Não vá embora.", PT, { kind: "pt-BR" })

  it("attributes the whole spoken sentence to João", () => {
    expect(sentence.attribution).toEqual({ kind: "speech", speaker: { kind: "slug", slug: "joao" } })
  })

  it("still chunks the verb group under the em-dash", () => {
    const verb = chunk(sentence, "VP", "vá")

    expect(lemmaAt(sentence, verb.head)).toBe("ir")
  })
})

describe("pt-BR: a resolved mention pins the subject", () => {
  const sentence = only("@[Maria] abriu a porta.", PT, { kind: "pt-BR" })

  it("marks Maria the subject with pinned provenance and keeps the positional object", () => {
    expect(provenanceOf(relation(sentence, "subject-of", "Maria", "abriu"))).toBe("pinned")
    expect(provenanceOf(relation(sentence, "object-of", "porta", "abriu"))).toBe("heuristic")
  })
})

describe("pt-BR: a mention overrides a subject the positional rule gets wrong", () => {
  // SOV order: the nearest NP before the verb is the object `o livro`, so the
  // positional rule alone names it the subject.
  const withoutPin = only("Maria o livro comprou.", PT, { kind: "pt-BR" })

  const withPin = only("@[Maria] o livro comprou.", PT, { kind: "pt-BR" })

  it("names the fronted object as subject when nothing pins it", () => {
    expect(subjectHeads(withoutPin, "comprou")).toEqual(["livro"])
  })

  it("names Maria the sole subject once the mention pins her", () => {
    expect(subjectHeads(withPin, "comprou")).toEqual(["Maria"])
    expect(provenanceOf(relation(withPin, "subject-of", "Maria", "comprou"))).toBe("pinned")
  })
})

describe("pt-BR: valency gates the object", () => {
  const sentence = only("O gato dormiu a tarde.", PT, { kind: "pt-BR" })

  it("keeps the subject but gives an intransitive verb no object, though an NP follows it", () => {
    expect(provenanceOf(relation(sentence, "subject-of", "gato", "dormiu"))).toBe("heuristic")
    expect(chunk(sentence, "NP", "tarde")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("en: SVO chunks, dependencies, an adjective modifier and PP attachment", () => {
  it("reads subject and object around a transitive verb", () => {
    const sentence = only("The dog chased the cat.", EN, { kind: "en-US" })

    expect(sentence.chunks.map((c) => c.kind)).toEqual(["NP", "VP", "NP"])
    expect(provenanceOf(relation(sentence, "subject-of", "dog", "chased"))).toBe("heuristic")
    expect(provenanceOf(relation(sentence, "object-of", "cat", "chased"))).toBe("heuristic")
  })

  it("attaches an adjective inside the NP to the noun head", () => {
    const sentence = only("The angry king shouted.", EN, { kind: "en-US" })

    const np = chunk(sentence, "NP", "king")

    expect(relation(sentence, "modifier-of", "angry", "king").head).toBe(np.head)
  })

  it("attaches a trailing PP to the verb it follows", () => {
    const sentence = only("The cat slept on the mat.", EN, { kind: "en-US" })

    const pp = chunk(sentence, "PP", "mat")

    expect(pp.kind).toBe("PP")
    expect(provenanceOf(relation(sentence, "modifier-of", "mat", "slept"))).toBe("heuristic")
  })
})

describe("pt-BR: a NOUN/VERB homograph after a subject NP reads as the finite verb", () => {
  const sentence = only("A beleza era uma sentença.", PT, { kind: "pt-BR" })

  it("tags `era` as the verb ser, not the noun era, and reads its subject", () => {
    const verb = chunk(sentence, "VP", "era")

    expect(lemmaAt(sentence, verb.head)).toBe("ser")
    expect(provenanceOf(relation(sentence, "subject-of", "beleza", "era"))).toBe("heuristic")
  })

  it("gives the copula no object though an NP follows it", () => {
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("pt-BR: a comma-bounded parenthetical between verb and object is hopped", () => {
  const sentence = only("Maria comprou, ontem, o livro.", PT, { kind: "pt-BR" })

  it("still reads the object NP past the parenthetical", () => {
    expect(provenanceOf(relation(sentence, "object-of", "livro", "comprou"))).toBe("heuristic")
  })
})

describe("pt-BR: an unclosed comma is a clause boundary, not a parenthetical", () => {
  const sentence = only("O gato comeu, a tarde caiu.", PT, { kind: "pt-BR" })

  it("never reads the next clause's subject as the first verb's object", () => {
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
    expect(provenanceOf(relation(sentence, "subject-of", "tarde", "caiu"))).toBe("heuristic")
  })
})

describe("pt-BR: a clausal complement is found past a parenthetical", () => {
  const sentence = only(
    "Kenzō compreendeu, aos dezessete anos, que a beleza era uma sentença.",
    PT,
    { kind: "pt-BR" },
  )

  it("attaches the `que` clause as complement of the matrix verb", () => {
    expect(provenanceOf(relation(sentence, "complement-of", "que", "compreendeu"))).toBe("heuristic")
  })

  it("claims no NP object once the complementizer opens the clause", () => {
    const objects = sentence.relations.filter(
      (r) => r.kind === "object-of" && textAt(sentence, r.head) === "compreendeu",
    )

    expect(objects).toEqual([])
  })

  it("still analyzes the embedded clause: ser is its verb and beleza its subject", () => {
    const embedded = chunk(sentence, "VP", "era")

    expect(lemmaAt(sentence, embedded.head)).toBe("ser")
    expect(provenanceOf(relation(sentence, "subject-of", "beleza", "era"))).toBe("heuristic")
  })
})

describe("pt-BR: a motion verb chains onto an infinitive complement", () => {
  const sentence = only("O senhor veio ver o pavilhão arder?", PT, { kind: "pt-BR" })

  it("tags the whole verb chain as verbs", () => {
    expect(lemmaAt(sentence, chunk(sentence, "VP", "veio").head)).toBe("vir")
    expect(lemmaAt(sentence, chunk(sentence, "VP", "ver").head)).toBe("ver")
    expect(lemmaAt(sentence, chunk(sentence, "VP", "arder").head)).toBe("arder")
  })

  it("attaches the infinitive to the motion verb though vir rejects an object", () => {
    expect(provenanceOf(relation(sentence, "complement-of", "ver", "veio"))).toBe("heuristic")
  })

  it("reads the perception verb's object and the small clause's own subject", () => {
    expect(provenanceOf(relation(sentence, "object-of", "pavilhão", "ver"))).toBe("heuristic")
    expect(provenanceOf(relation(sentence, "subject-of", "pavilhão", "arder"))).toBe("heuristic")
  })
})

describe("pt-BR: a post-verbal adverbial locution never becomes an object", () => {
  const sentence = only(
    "Minoru comeu assim mesmo, de pé, olhando o quintal do vizinho.",
    PT,
    { kind: "pt-BR" },
  )

  it("reads `assim mesmo` as adverbs, not a noun phrase", () => {
    expect(posOf(sentence, "assim")).toBe("ADV")
    expect(posOf(sentence, "mesmo")).toBe("ADV")
  })

  it("gives comeu no object though it is transitive", () => {
    expect(objectsOf(sentence, "comeu")).toEqual([])
  })
})

describe("pt-BR: a bare locative adverb after a verb is no object", () => {
  const sentence = only("Então o verão existe mesmo aí.", PT, { kind: "pt-BR" })

  it("reads `mesmo aí` as adverbs and keeps the preverbal subject", () => {
    expect(posOf(sentence, "mesmo")).toBe("ADV")
    expect(posOf(sentence, "aí")).toBe("ADV")
    expect(subjectHeads(sentence, "existe")).toEqual(["verão"])
  })

  it("claims no object and no postverbal subject once a preverbal one exists", () => {
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("pt-BR: an existential verb takes its postverbal NP as subject", () => {
  const sentence = only("Aqui só existe o vento.", PT, { kind: "pt-BR" })

  it("reads the sentence-opening adverbs as adverbs", () => {
    expect(posOf(sentence, "Aqui")).toBe("ADV")
    expect(posOf(sentence, "só")).toBe("ADV")
  })

  it("makes vento the subject of existir, never its object", () => {
    expect(provenanceOf(relation(sentence, "subject-of", "vento", "existe"))).toBe("heuristic")
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("pt-BR: a verb-initial presentational clause inverts the same way", () => {
  const sentence = only("Restava uma única linha.", PT, { kind: "pt-BR" })

  it("makes linha the postverbal subject of restar", () => {
    expect(provenanceOf(relation(sentence, "subject-of", "linha", "Restava"))).toBe("heuristic")
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("en: the existential expletive licenses a postverbal subject", () => {
  const sentence = only("There exists a solution.", EN, { kind: "en-US" })

  it("reads there as an adverb and solution as the subject of exist", () => {
    expect(posOf(sentence, "There")).toBe("ADV")
    expect(provenanceOf(relation(sentence, "subject-of", "solution", "exists"))).toBe("heuristic")
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("en: `that` opens a clausal complement", () => {
  const sentence = only("She said that the dog barked.", EN, { kind: "en-US" })

  it("attaches the that-clause as complement of said and claims no object", () => {
    expect(provenanceOf(relation(sentence, "complement-of", "that", "said"))).toBe("heuristic")
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("en: a written quote is attributed to its writer", () => {
  const sentence = only("\"[Maria] The dog barked.\"", EN, { kind: "en-US" })

  it("attributes a sentence wholly inside the quote to Maria as writer", () => {
    expect(sentence.attribution).toEqual({ kind: "written", writer: { kind: "slug", slug: "maria" } })
  })
})
