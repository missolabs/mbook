// The English literary corpus — the same four voices as the Portuguese file
// (Mishima, Dazai, Murakami, Junji Ito), each passage pinning a grammar
// behavior end-to-end through analyzeParagraph: passives with agents,
// possessives, interrogative inversion, existential expletives, perfects,
// relatives, coordination and dialogue attribution tails.

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

const EN = open("en")

const CAST: Cast = {
  characters: [
    { name: "Yozo", slug: "yozo" },
    { name: "Kirie", slug: "kirie" },
    { name: "Kumiko", slug: "kumiko" },
  ],
}

function analyze(text: string): ParagraphAnalysis {
  return analyzeParagraph({ text, spans: scanLine(text, CAST), lexicon: EN, language: { kind: "en-US" } })
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

describe("Mishima: the pavilion, burned — a regular verb's passive", () => {
  const sentence = only("The Golden Pavilion was burned by the young monk.")

  it("marks the regular -ed participle as a participle, not just a past", () => {
    expect(tagged(sentence, "burned").lemma).toBe("burn")
    expect(tagged(sentence, "burned").feat).toBe("PASTPART")
  })

  it("keeps the patient as subject and chains the participle onto be", () => {
    expect(dependentsOf(sentence, "subject-of", "burned")).toEqual(["Pavilion"])
    expect(relation(sentence, "complement-of", "burned", "was")).toBeDefined()
  })

  it("reads the by-phrase as the agent and claims no object", () => {
    expect(relation(sentence, "agent-of", "monk", "burned")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("Mishima: beauty and the sailor's glory — predicates and possessives", () => {
  it("links the postverbal NP to the copula as its predicate", () => {
    const sentence = only("Beauty was a sentence.")

    expect(relation(sentence, "subject-of", "Beauty", "was")).toBeDefined()
    expect(relation(sentence, "predicate-of", "sentence", "was")).toBeDefined()
  })

  it("reads the possessive marker and hangs the owner off the owned", () => {
    const sentence = only("The sailor's glory was the sea.")

    expect(tagged(sentence, "'s").pos).toBe("PART")
    expect(tagged(sentence, "'s").feat).toBe("Poss")
    expect(relation(sentence, "modifier-of", "sailor", "glory")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "was")).toEqual(["glory"])
    expect(relation(sentence, "predicate-of", "sea", "was")).toBeDefined()
  })

  it("hangs the possessed subject on its own verb", () => {
    const sentence = only("The cat's tail twitched.")

    expect(relation(sentence, "modifier-of", "cat", "tail")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "twitched")).toEqual(["tail"])
  })
})

describe("Dazai: mine has been a life of much shame", () => {
  const analysis = analyze("\"[Yozo] Mine has been a life of much shame.\"")
  const sentence = analysis.sentences[0]!

  it("attributes the written confession to Yozo", () => {
    expect(sentence.attribution).toEqual({ kind: "written", writer: { kind: "slug", slug: "yozo" } })
  })

  it("chains been onto has and predicates the life", () => {
    expect(relation(sentence, "complement-of", "been", "has")).toBeDefined()
    expect(relation(sentence, "predicate-of", "life", "been")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "been")).toEqual(["Mine"])
  })
})

describe("Dazai: negation, questions and what shame does", () => {
  it("finds the verb behind did not and gives it the object", () => {
    const sentence = only("He did not see the sea.")

    expect(tagged(sentence, "see").pos).toBe("VERB")
    expect(relation(sentence, "subject-of", "He", "see")).toBeDefined()
    expect(relation(sentence, "object-of", "sea", "see")).toBeDefined()
    expect(dependentsOf(sentence, "object-of", "did")).toEqual([])
  })

  it("un-inverts the interrogative copula: it is the subject, the dream the predicate", () => {
    const sentence = only("Was it a dream?")

    expect(relation(sentence, "subject-of", "it", "Was")).toBeDefined()
    expect(relation(sentence, "predicate-of", "dream", "Was")).toBeDefined()
  })

  it("reads a pronoun object and attaches the simile PP", () => {
    const sentence = only("Shame followed him like a shadow.")

    expect(relation(sentence, "object-of", "him", "followed")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "followed")).toEqual(["Shame"])
  })

  it("shares the drinker across three coordinated verbs", () => {
    const sentence = only("Yozo drank and laughed and wept.")

    expect(dependentsOf(sentence, "subject-of", "drank")).toEqual(["Yozo"])
    expect(dependentsOf(sentence, "subject-of", "laughed")).toEqual(["Yozo"])
    expect(dependentsOf(sentence, "subject-of", "wept")).toEqual(["Yozo"])
  })

  it("keeps the object with the first verb, the subject with both", () => {
    const sentence = only("Yozo opened the door and wept.")

    expect(relation(sentence, "object-of", "door", "opened")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "wept")).toEqual(["Yozo"])
  })
})

describe("Murakami: there was a well — the existential expletive", () => {
  it("makes the postverbal NP the subject, never the predicate", () => {
    const sentence = only("There was a well in the garden.")

    expect(tagged(sentence, "There").pos).toBe("ADV")
    expect(relation(sentence, "subject-of", "well", "was")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "predicate-of")).toEqual([])
  })

  it("inverts the plural existential the same way", () => {
    const sentence = only("There were no stars.")

    expect(relation(sentence, "subject-of", "stars", "were")).toBeDefined()
  })

  it("licenses the bare narrative inversion of come", () => {
    const sentence = only("Then came the winter.")

    expect(relation(sentence, "subject-of", "winter", "came")).toBeDefined()
    expect(sentence.relations.filter((r) => r.kind === "object-of")).toEqual([])
  })
})

describe("Murakami: the record spun — discourse across sentences", () => {
  it("resolves a bare transitive drink to the poured coffee", () => {
    const analysis = analyze("Kumiko poured the coffee. Yozo drank.")

    expect(analysis.discourse.length).toBe(1)
    expect(analysis.discourse[0]!.fromSentence).toBe(1)
    expect(analysis.discourse[0]!.toSentence).toBe(0)
  })

  it("builds no link for a prepositional verb — listening elides nothing", () => {
    const analysis = analyze("The record spun. Kumiko listened.")

    expect(analysis.discourse).toEqual([])
  })
})

describe("Murakami: the woman who called — relatives and the perfect", () => {
  it("subjects the antecedent to both the relative and the matrix verb", () => {
    const sentence = only("The woman who called never gave her name.")

    expect(dependentsOf(sentence, "subject-of", "called")).toEqual(["woman"])
    expect(dependentsOf(sentence, "subject-of", "gave")).toEqual(["woman"])
    expect(relation(sentence, "object-of", "name", "gave")).toBeDefined()
  })

  it("resolves an OBJECT relative — the letter is what the priest burned", () => {
    const sentence = only("She kept the letter which the priest burned.")

    expect(relation(sentence, "object-of", "letter", "kept")).toBeDefined()
    expect(relation(sentence, "object-of", "letter", "burned")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "burned")).toEqual(["priest"])
  })

  it("hands the perfect participle its object across had", () => {
    const sentence = only("Kumiko had seen the cat before.")

    expect(tagged(sentence, "seen").feat).toBe("PASTPART")
    expect(relation(sentence, "object-of", "cat", "seen")).toBeDefined()
    expect(relation(sentence, "complement-of", "seen", "had")).toBeDefined()
    expect(dependentsOf(sentence, "object-of", "had")).toEqual([])
  })
})

describe("Ito: the spiral takes the town", () => {
  it("spreads the horror across coordinated witnesses", () => {
    const sentence = only("Kirie and her brother saw the spiral.")

    expect(dependentsOf(sentence, "subject-of", "saw").sort()).toEqual(["Kirie", "brother"])
    expect(relation(sentence, "object-of", "spiral", "saw")).toBeDefined()
  })

  it("carries the swallowed town through the perfect", () => {
    const sentence = only("The spiral had swallowed the town.")

    expect(relation(sentence, "object-of", "town", "swallowed")).toBeDefined()
    expect(relation(sentence, "complement-of", "swallowed", "had")).toBeDefined()
  })

  it("keeps the vanishing cat's subject across the conjunction", () => {
    const sentence = only("The cat crossed the garden wall and vanished.")

    expect(relation(sentence, "object-of", "wall", "crossed")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "vanished")).toEqual(["cat"])
  })

  it("builds no elided-object link off a passive — the fish was simply eaten", () => {
    const analysis = analyze("The fish was eaten. The cat slept.")

    expect(analysis.discourse).toEqual([])
  })
})

describe("dialogue: attribution tails never split the sentence", () => {
  it("keeps a quoted question and its attribution together", () => {
    const sentence = only("“Did you see the cat?” she asked.")

    expect(relation(sentence, "subject-of", "you", "see")).toBeDefined()
    expect(relation(sentence, "object-of", "cat", "see")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "asked")).toEqual(["she"])
    expect(dependentsOf(sentence, "object-of", "Did")).toEqual([])
  })

  it("carries a trailing ellipsis inside the quote into the attribution", () => {
    const sentence = only("“I was ashamed…” he wrote.")

    expect(relation(sentence, "predicate-of", "ashamed", "was")).toBeDefined()
    expect(dependentsOf(sentence, "subject-of", "wrote")).toEqual(["he"])
  })
})
