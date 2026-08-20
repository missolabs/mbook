// The dataflow pass — cross-statement analysis. Sentence-local Relations
// cannot reach across statements (their endpoints are token indices inside
// ONE sentence), so this pass runs after the whole paragraph is bound and
// links what a statement consumes from its predecessors — the same shape as
// a compiler's dataflow analysis over a basic block, where the paragraph is
// the block and cross-paragraph flow is deliberately out of scope. The single
// link kind so far is the elided object — "O espaguete passou do ponto.
// Minoru comeu assim mesmo." leaves `comer` (declared transitive) with
// nothing after binding, and Portuguese licenses dropping an object whose
// referent is discourse-given. The pass is deliberately narrow and honest:
//   * only verbs the valency data marks transitive/ditransitive qualify — an
//     unlisted verb defaulting to "may take an object" is not evidence one was
//     elided;
//   * a verb that DID find an object-of or complement-of is finished; the
//     sentence-local relations always win;
//   * the antecedent is searched only among PRECEDING sentences of the SAME
//     paragraph, nearest first — cross-paragraph resolution is guesswork this
//     engine refuses. The nearest sentence offering a head wins: its last
//     object-of dependent, else its last subject-of dependent (recency is the
//     standard anaphora preference);
//   * a candidate subject that is a resolved character mention is skipped when
//     the elided verb's own subject is that same character — a character does
//     not eat himself — and the search continues one sentence further back.
//
// A link's endpoints are (sentence index within the paragraph, token index
// within that sentence): the same coordinates Relation uses, lifted one level.

import type { Optional } from "../optional"
import type { AnchoredSpan, Sentence } from "./pipeline"
import type { SyntaxData, ValencyFrame, ValencyHint } from "./model"
import type { Relation } from "./binder"

export type DiscourseLinkKind = "elided-object" | "elided-subject"

export type DiscourseProvenance = "discourse"

export type DiscourseLink = {
  kind: DiscourseLinkKind
  fromSentence: number
  fromToken: number
  toSentence: number
  toToken: number
  provenance: DiscourseProvenance
}

export type DiscourseInput = {
  sentences: readonly Sentence[]
  spans: readonly AnchoredSpan[]
  syntax: SyntaxData
}

export function linkDiscourse(input: DiscourseInput): readonly DiscourseLink[] {
  const links: DiscourseLink[] = []

  input.sentences.forEach((sentence, si) => {
    // Continuity claims one verb at a time: a sentence where SEVERAL verbs
    // lack subjects is an impersonal or infinitival construction (`sair do
    // trabalho significava entrar...`), not an elided subject.
    const continuity = subjectlessThirdVerbs(sentence, input.syntax)
    const eligible = continuity.length === 1 && subjectlessVpCount(sentence) === 1

    for (const verb of eligible ? continuity : []) {
      const antecedent = resolveSubjectAntecedent(input, si)

      switch (antecedent.kind) {
        case "none":
          continue
        case "some":
          links.push({
            kind: "elided-subject",
            fromSentence: si,
            fromToken: verb,
            toSentence: antecedent.value.sentence,
            toToken: antecedent.value.token,
            provenance: "discourse",
          })
          continue
      }
    }

    for (const verb of objectlessTransitiveVerbs(sentence, input.syntax)) {
      const antecedent = resolveAntecedent(input, si, verb)

      switch (antecedent.kind) {
        case "none":
          continue
        case "some":
          links.push({
            kind: "elided-object",
            fromSentence: si,
            fromToken: verb,
            toSentence: antecedent.value.sentence,
            toToken: antecedent.value.token,
            provenance: "discourse",
          })
          continue
      }
    }
  })

  return links
}

type Anchor = { sentence: number; token: number }

// Pro-drop subject continuity: a finite, third-person-compatible verb with no
// subject of its own continues the subject already on stage — "Rei chegou.
// Sentou-se." keeps Rei sitting. Deliberately narrow:
//   * narration only — dialogue turns change speakers, so speech is excluded;
//   * the verb must be finite and its person marking must ADMIT third person
//     (a 1st/2nd-marked form like `cheguei` is the narrator, who is not an NP
//     and is not guessed at);
//   * copular and presentational frames are excused — `Foram muitos anos`,
//     `Havia gelo` are impersonal, not elliptical;
//   * the antecedent is the nearest preceding sentence's last subject, the
//     same recency rule the elided-object pass uses.
function subjectlessThirdVerbs(sentence: Sentence, syntax: SyntaxData): readonly number[] {
  switch (sentence.attribution.kind) {
    case "narration":
      break
    case "speech":
      return []
    case "written":
      return []
  }

  const out: number[] = []

  for (const chunk of sentence.chunks) {
    switch (chunk.kind) {
      case "VP":
        break
      case "NP":
        continue
      case "PP":
        continue
    }

    const feat = featAt(sentence, chunk.head)
    const finite = syntax.verbFeats.finitePrefixes.some((p) => feat.startsWith(p))
    const thirdCompatible = feat.includes("3") || /[12]/.test(feat) === false

    switch (finite && thirdCompatible) {
      case false:
        continue
      case true:
        break
    }

    switch (impersonalFrame(lemmaAt(sentence, chunk.head), syntax.valency)) {
      case true:
        continue
      case false:
        break
    }

    // Any argument of its own disqualifies the verb: `Faz muito tempo`
    // carries its temporal pseudo-object and is impersonal, not elliptical.
    // The conservative price — `Abriu a porta.` loses its continuity — is
    // accepted and documented.
    const engaged = sentence.relations.some(
      (r) =>
        (r.kind === "subject-of" || r.kind === "object-of" || r.kind === "complement-of") &&
        r.head === chunk.head,
    )

    switch (engaged) {
      case true:
        continue
      case false:
        out.push(chunk.head)
        continue
    }
  }

  return out
}

function subjectlessVpCount(sentence: Sentence): number {
  let count = 0

  for (const chunk of sentence.chunks) {
    switch (chunk.kind) {
      case "VP":
        break
      case "NP":
        continue
      case "PP":
        continue
    }

    const subjected = sentence.relations.some(
      (r) => r.kind === "subject-of" && r.head === chunk.head,
    )

    switch (subjected) {
      case true:
        continue
      case false:
        count++
        continue
    }
  }

  return count
}

function impersonalFrame(lemma: string, valency: readonly ValencyHint[]): boolean {
  const hit = valency.find((v) => v.lemma === lemma)

  switch (hit === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (hit!.frame) {
    case "copular":
      return true
    case "presentational":
      return true
    case "intransitive":
      return false
    case "transitive":
      return false
    case "ditransitive":
      return false
    case "prepositional":
      return false
  }
}

function resolveSubjectAntecedent(input: DiscourseInput, si: number): Optional<Anchor> {
  for (let sj = si - 1; sj >= 0; sj--) {
    const subject = lastDependent(input.sentences[sj]!, "subject-of")

    switch (subject.kind) {
      case "none":
        continue
      case "some":
        return { kind: "some", value: { sentence: sj, token: subject.value } }
    }
  }

  return { kind: "none" }
}

// VP heads whose lemma the valency data declares object-taking, yet no
// object-of or complement-of relation was built for. Two periphrasis shapes
// are excused, not elided:
//   * an auxiliary head another VP chains onto (`tinha` in `tinha comido`) —
//     its complement-of already claims it;
//   * a PASSIVE participle (`comido` in `foi comido`): the patient became the
//     subject, so the missing object is the construction, not an ellipsis.
//     A participle chained onto ter/haver/have keeps its candidacy — `Ela
//     tinha comido.` really does elide what she ate.
function objectlessTransitiveVerbs(sentence: Sentence, syntax: SyntaxData): readonly number[] {
  const out: number[] = []

  for (const chunk of sentence.chunks) {
    switch (chunk.kind) {
      case "VP":
        break
      case "NP":
        continue
      case "PP":
        continue
    }

    const expects = expectsObject(lemmaAt(sentence, chunk.head), syntax.valency)
    const found = sentence.relations.some((r) => claimsObject(r, chunk.head))

    switch (expects && found === false && isPassiveParticiple(sentence, chunk.head, syntax) === false) {
      case true:
        out.push(chunk.head)
        continue
      case false:
        continue
    }
  }

  return out
}

// This verb is a participle chained (complement-of) onto a passive auxiliary.
function isPassiveParticiple(sentence: Sentence, head: number, syntax: SyntaxData): boolean {
  const participle = featAt(sentence, head).length > 0 &&
    syntax.verbFeats.participlePrefixes.some((p) => featAt(sentence, head).startsWith(p))

  switch (participle) {
    case false:
      return false
    case true:
      break
  }

  const chain = sentence.relations.find((r) => r.kind === "complement-of" && r.dependent === head)

  switch (chain === undefined) {
    case true:
      return false
    case false:
      return syntax.passiveAuxiliaries.includes(lemmaAt(sentence, chain!.head))
  }
}

function featAt(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "content":
      return token.tagged.feat
    case "punctuation":
      return ""
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

function claimsObject(relation: Relation, head: number): boolean {
  switch (relation.kind) {
    case "object-of":
      return relation.head === head
    case "complement-of":
      return relation.head === head
    case "subject-of":
      return false
    case "modifier-of":
      return false
    case "predicate-of":
      return false
    case "agent-of":
      return false
    case "located-in":
      return false
  }
}

function expectsObject(lemma: string, valency: readonly ValencyHint[]): boolean {
  const hit = valency.find((v) => v.lemma === lemma)

  switch (hit === undefined) {
    case true:
      return false
    case false:
      return frameExpectsObject(hit!.frame)
  }
}

function frameExpectsObject(frame: ValencyFrame): boolean {
  switch (frame) {
    case "transitive":
      return true
    case "ditransitive":
      return true
    case "intransitive":
      return false
    case "copular":
      return false
    case "prepositional":
      return false
    case "presentational":
      return false
  }
}

// Nearest preceding sentence first: its last object head, else its last subject
// head — unless that subject is the very character doing the eliding, in which
// case the search steps one sentence further back.
function resolveAntecedent(input: DiscourseInput, si: number, verb: number): Optional<Anchor> {
  const eater = subjectCharacter(input, si, verb)

  for (let sj = si - 1; sj >= 0; sj--) {
    const sentence = input.sentences[sj]!

    const object = lastDependent(sentence, "object-of")

    switch (object.kind) {
      case "some":
        return { kind: "some", value: { sentence: sj, token: object.value } }
      case "none":
        break
    }

    const subject = lastDependent(sentence, "subject-of")

    switch (subject.kind) {
      case "none":
        continue
      case "some":
        break
    }

    switch (sameCharacter(eater, characterAt(input.spans, sj, subject.value))) {
      case true:
        continue
      case false:
        return { kind: "some", value: { sentence: sj, token: subject.value } }
    }
  }

  return { kind: "none" }
}

function lastDependent(sentence: Sentence, kind: "object-of" | "subject-of"): Optional<number> {
  let found: Optional<number> = { kind: "none" }

  for (const relation of sentence.relations) {
    switch (relation.kind === kind) {
      case true:
        found = { kind: "some", value: relation.dependent }
        continue
      case false:
        continue
    }
  }

  return found
}

// The character slug behind the verb's own subject, when its subject token sits
// inside a resolved subject-mention span.
function subjectCharacter(input: DiscourseInput, si: number, verb: number): Optional<string> {
  const sentence = input.sentences[si]!
  const subject = sentence.relations.find((r) => r.kind === "subject-of" && r.head === verb)

  switch (subject === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return characterAt(input.spans, si, subject!.dependent)
  }
}

function characterAt(spans: readonly AnchoredSpan[], sentence: number, token: number): Optional<string> {
  for (const anchored of spans) {
    const slug = mentionSlug(anchored, sentence, token)

    switch (slug.kind) {
      case "some":
        return slug
      case "none":
        continue
    }
  }

  return { kind: "none" }
}

function mentionSlug(anchored: AnchoredSpan, sentence: number, token: number): Optional<string> {
  switch (anchored.span.kind === "subject-mention") {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const binding = anchored.span.binding

  switch (binding.kind) {
    case "unresolved":
      return { kind: "none" }
    case "unknown":
      return { kind: "none" }
    case "resolved":
      break
  }

  const anchor = anchored.anchor

  switch (anchor.kind) {
    case "detached":
      return { kind: "none" }
    case "in-sentence":
      break
  }

  switch (anchor.sentence === sentence && anchor.tokens.includes(token)) {
    case true:
      return { kind: "some", value: binding.slug }
    case false:
      return { kind: "none" }
  }
}

function sameCharacter(a: Optional<string>, b: Optional<string>): boolean {
  switch (a.kind) {
    case "none":
      return false
    case "some":
      break
  }

  switch (b.kind) {
    case "none":
      return false
    case "some":
      return a.value === b.value
  }
}
