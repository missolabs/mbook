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

export type DiscourseLinkKind =
  | "elided-object"
  | "elided-subject"
  // A referring pronoun bound to its antecedent: `ela` -> the nearest
  // preceding agreeing nominal, `seu caderno` -> the nearest subject.
  | "anaphora"
  // Definiteness chains: `um poço` introduces an entity, a later `o poço`
  // resumes it — the definite NP links back to its introduction.
  | "coreference"
  // Rhetorical connectives: a sentence opening on `mas`/`but` CONTRASTS with
  // its predecessor, on `portanto`/`so` follows from it.
  | "contrast"
  | "consequence"
  // A verbless polar fragment copies the previous verb: `Eu também.`,
  // `Daniela não.` — the NP does (or does not do) what was just done.
  | "fragment"
  // Bridging reference: a definite PART resumes the WHOLE on stage — `o
  // carro ... O MOTOR` links the engine to its car through the declared
  // meronymy table.
  | "bridging"

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
    // The narrator claims first: an {Eu}-scoped person-ambiguous verb (I13s)
    // is the narrator's, and only the leftovers enter 3rd-person continuity.
    linkFirstPerson(links, input, si)

    // Continuity claims one verb at a time: a sentence where SEVERAL verbs
    // lack subjects is an impersonal or infinitival construction (`sair do
    // trabalho significava entrar...`), not an elided subject.
    const continuity = subjectlessThirdVerbs(sentence, input.syntax).filter(
      (verb) => hasLink(links, "elided-subject", si, verb) === false,
    )
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

    linkAnaphors(links, input, si)
    linkRhetorical(links, input, si)
    linkFragments(links, input, si)
  })

  linkCoreference(links, input)
  linkBridging(links, input)

  return links
}

// Bridging, paragraph-local: a definite NP whose head is a declared PART of
// some whole already on stage — and which was never introduced in its own
// right (its own indefinite would make it plain coreference) — links to the
// most recent mention of the whole.
function linkBridging(links: DiscourseLink[], input: DiscourseInput): void {
  const staged = new Map<string, Anchor>()
  const introduced = new Set<string>()

  input.sentences.forEach((sentence, si) => {
    for (const chunk of sentence.chunks) {
      switch (chunk.kind) {
        case "NP":
          break
        case "VP":
          continue
        case "PP":
          continue
      }

      const opener = sentence.tokens[chunk.from]!
      const head = sentence.tokens[chunk.head]!

      switch (head.role === "content" && head.tagged.pos === "NOUN") {
        case false:
          continue
        case true:
          break
      }

      const lemma = (head as { tagged: { lemma: string } }).tagged.lemma
      const article = opener.role === "content" ? opener.tagged.token.text.toLowerCase() : ""

      switch (input.syntax.indefiniteArticles.includes(article)) {
        case true:
          introduced.add(lemma)
          break
        case false:
          break
      }

      const definite = input.syntax.definiteArticles.includes(article)
      const alreadyLinked = hasLink(links, "coreference", si, chunk.head)

      const bridgeable = definite && introduced.has(lemma) === false && alreadyLinked === false

      switch (bridgeable) {
        case false:
          break
        case true: {
          const whole = mostRecentWhole(input, staged, lemma)

          switch (whole.kind) {
            case "none":
              break
            case "some":
              links.push({
                kind: "bridging",
                fromSentence: si,
                fromToken: chunk.head,
                toSentence: whole.value.sentence,
                toToken: whole.value.token,
                provenance: "discourse",
              })
              break
          }
          break
        }
      }

      // Every nominal mention takes the stage AFTER it was considered as a
      // part — a whole cannot bridge to itself.
      staged.set(lemma, { sentence: si, token: chunk.head })
    }
  })
}

// The most recently staged whole this part is declared under; several wholes
// may claim the part (porta: casa, carro) and recency arbitrates.
function mostRecentWhole(
  input: DiscourseInput,
  staged: ReadonlyMap<string, Anchor>,
  part: string,
): Optional<Anchor> {
  let best: Optional<Anchor> = { kind: "none" }

  for (const pair of input.syntax.meronymy) {
    switch (pair.part === part) {
      case false:
        continue
      case true:
        break
    }

    const anchor = staged.get(pair.whole)

    switch (anchor === undefined) {
      case true:
        continue
      case false:
        break
    }

    const later =
      best.kind === "none" ||
      anchor!.sentence > (best as { value: Anchor }).value.sentence ||
      (anchor!.sentence === (best as { value: Anchor }).value.sentence &&
        anchor!.token > (best as { value: Anchor }).value.token)

    switch (later) {
      case true:
        best = { kind: "some", value: anchor! }
        continue
      case false:
        continue
    }
  }

  return best
}

// A sentence-initial rhetorical connective asserts a relation to the
// PREVIOUS sentence: contrast (`Mas...`) or consequence (`Portanto...`).
// The link runs from the marker token to the previous sentence's first verb.
function linkRhetorical(links: DiscourseLink[], input: DiscourseInput, si: number): void {
  switch (si === 0) {
    case true:
      return
    case false:
      break
  }

  const sentence = input.sentences[si]!

  for (const [ti, token] of sentence.tokens.entries()) {
    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        break
    }

    const marker = input.syntax.discourseMarkers.find(
      (m) => m.form === token.tagged.token.text.toLowerCase(),
    )

    switch (marker === undefined) {
      case true:
        return
      case false:
        break
    }

    const previous = input.sentences[si - 1]!
    const anchor = previous.chunks.find((c) => c.kind === "VP")

    switch (anchor === undefined) {
      case true:
        return
      case false:
        links.push({
          kind: marker!.sense,
          fromSentence: si,
          fromToken: ti,
          toSentence: si - 1,
          toToken: anchor!.head,
          provenance: "discourse",
        })
        return
    }
  }
}

// A verbless sentence of `NP + também/sim/não` inherits the previous
// sentence's verb: `Rei chorou. Eu também.` — the fragment's NP links to the
// verb it silently repeats. Whether it AFFIRMS or DENIES is read off the
// particle by consumers.
function linkFragments(links: DiscourseLink[], input: DiscourseInput, si: number): void {
  switch (si === 0) {
    case true:
      return
    case false:
      break
  }

  const sentence = input.sentences[si]!

  const verbless = sentence.chunks.every((c) => c.kind !== "VP")
  const np = sentence.chunks.find((c) => c.kind === "NP")

  switch (verbless && np !== undefined) {
    case false:
      return
    case true:
      break
  }

  const particle = sentence.tokens.some((t) => {
    switch (t.role) {
      case "punctuation":
        return false
      case "content":
        return input.syntax.fragmentParticles.includes(t.tagged.token.text.toLowerCase())
    }
  })

  switch (particle) {
    case false:
      return
    case true:
      break
  }

  const previous = input.sentences[si - 1]!

  let verb: Optional<number> = { kind: "none" }

  for (const c of previous.chunks) {
    switch (c.kind === "VP") {
      case true:
        verb = { kind: "some", value: c.head }
        continue
      case false:
        continue
    }
  }

  switch (verb.kind) {
    case "none":
      return
    case "some":
      links.push({
        kind: "fragment",
        fromSentence: si,
        fromToken: np!.head,
        toSentence: si - 1,
        toToken: verb.value,
        provenance: "discourse",
      })
      return
  }
}

// ─── anaphora ────────────────────────────────────────────────────────────────
// Referring pronouns bound backward. A personal anaphor (`ela`, `she`)
// demands agreement of its antecedent — a gender/number feat when the
// nominal carries one, a surface guess (final -a feminine) for bare proper
// names, nothing for a declared featless anaphor (`they`). A possessive
// (`seu`, `his`) agrees with the POSSESSED, not the owner, so it skips
// agreement entirely and takes the nearest preceding subject — the standard
// centering preference.
function linkAnaphors(links: DiscourseLink[], input: DiscourseInput, si: number): void {
  const sentence = input.sentences[si]!

  sentence.tokens.forEach((token, ti) => {
    switch (token.role) {
      case "punctuation":
        return
      case "content":
        break
    }

    const lower = token.tagged.token.text.toLowerCase()
    const hint = input.syntax.anaphoricPronouns.find((a) => a.form === lower)

    // An article-shaped anaphor (the o/a/os/as clitics) refers only when the
    // binder actually bound it as a verb argument — a plain article inside an
    // NP never fires.
    const articleShaped = hint !== undefined && input.syntax.definiteArticles.includes(lower)

    const bound = sentence.relations.some(
      (r) => (r.kind === "object-of" || r.kind === "dative-of") && r.dependent === ti,
    )

    switch (articleShaped && bound === false) {
      case true:
        return
      case false:
        break
    }

    switch (hint !== undefined) {
      case true: {
        const antecedent = resolveAgreeing(input, si, ti, hint!.feat)

        switch (antecedent.kind) {
          case "some":
            links.push(anaphoraLink(si, ti, antecedent.value))
            return
          case "none":
            break
        }

        // SPLIT ANTECEDENT: a plural with no plural nominal behind it may sum
        // a coordination of singulars — one link per conjunct.
        const summed = resolveCoordination(input, si, ti, hint!.feat)

        switch (summed.length >= 2) {
          case true: {
            for (const anchor of summed) {
              links.push(anaphoraLink(si, ti, anchor))
            }
            return
          }
          case false:
            break
        }

        // CATAPHORA: a pronoun with nothing behind it may point forward to
        // its own sentence's matrix subject — `Quando ELA chegou, Daniela
        // sorriu`.
        const forward = resolveForward(input, si, ti, hint!.feat)

        switch (forward.kind) {
          case "some":
            links.push(anaphoraLink(si, ti, forward.value))
            return
          case "none":
            return
        }
      }
      case false:
        break
    }

    switch (input.syntax.possessivePronouns.includes(lower)) {
      case false:
        return
      case true:
        break
    }

    const owner = nearestSubjectAnchor(input, si, ti)

    switch (owner.kind) {
      case "some":
        links.push(anaphoraLink(si, ti, owner.value))
        return
      case "none":
        return
    }
  })
}

function anaphoraLink(si: number, ti: number, to: Anchor): DiscourseLink {
  return {
    kind: "anaphora",
    fromSentence: si,
    fromToken: ti,
    toSentence: to.sentence,
    toToken: to.token,
    provenance: "discourse",
  }
}

// The nearest preceding nominal agreeing with the demanded feat — with the
// centering preference inside each sentence: SUBJECTS first (`Ele` after
// `Rei olhava o poço em silêncio` is Rei), then other arguments (objects,
// recipients, obliques), then any nominal chunk head. Nearest sentence wins
// before role does.
function resolveAgreeing(input: DiscourseInput, si: number, ti: number, feat: string): Optional<Anchor> {
  for (let sj = si; sj >= 0; sj--) {
    const sentence = input.sentences[sj]!
    const limit = sj === si ? ti : sentence.tokens.length

    for (const tier of [subjectTier, argumentTier, anyTier]) {
      for (let at = limit - 1; at >= 0; at--) {
        switch (tier(sentence, at) && agrees(sentence, at, feat)) {
          case true:
            return { kind: "some", value: { sentence: sj, token: at } }
          case false:
            continue
        }
      }
    }

  }

  return { kind: "none" }
}

// ─── split antecedents ───────────────────────────────────────────────────────
// A plural pronoun with no plural antecedent may SUM a coordination of
// singulars: `Tinha uma esposa, que também não era de S, e uma filha. …
// nenhuma referência a ELAS` — esposa + filha, joined by the conjunction,
// are the referent no single nominal can be. The rule is gender-strict the
// way Portuguese is: a feminine plural demands every conjunct feminine (an
// unknown never passes — the relative clause's `S` must not sneak in); a
// masculine plural absorbs any mix. One link per conjunct — the graph
// credits them all.
function resolveCoordination(input: DiscourseInput, si: number, ti: number, feat: string): readonly Anchor[] {
  switch (feat.length > 1 && feat[1] === "p") {
    case false:
      return []
    case true:
      break
  }

  for (let sj = si; sj >= 0; sj--) {
    const sentence = input.sentences[sj]!
    const limit = sj === si ? ti : sentence.tokens.length
    const conjuncts = conjunctsBefore(sentence, limit, feat)

    switch (conjuncts.length >= 2) {
      case true:
        return conjuncts.map((token) => ({ sentence: sj, token }))
      case false:
        continue
    }
  }

  return []
}

// The conjunct heads of the last additive coordination before `limit`, in
// textual order: the NP right after the final `e`/`and`, its mate the nearest
// earlier NP that is neither a preposition's object nor of an incompatible
// gender, and further NPs chained on by bare commas. Relative clauses and
// other chunks BETWEEN conjuncts are stepped over; a gender-incompatible NP
// is a hard stop — a mixed pair is not a feminine sum.
function conjunctsBefore(sentence: Sentence, limit: number, feat: string): readonly number[] {
  const chunks = sentence.chunks

  for (let k = chunks.length - 1; k >= 0; k--) {
    const last = chunks[k]!

    const opens =
      last.kind === "NP" &&
      last.to <= limit &&
      nominalHead(sentence, last.head) &&
      additiveConjAt(sentence, last.from - 1) &&
      genderCompatible(sentence, last.head, feat)

    switch (opens) {
      case false:
        continue
      case true:
        break
    }

    const mates = mateChain(sentence, chunks, k, feat)

    switch (mates.length === 0) {
      case true:
        return []
      case false:
        return [...mates, last.head]
    }
  }

  return []
}

// Walk back from the after-conj conjunct: skip non-NP chunks (the relative
// clause's VP) and preposition-governed NPs (`de S`), stop hard on a wrong
// gender. The first mate found may extend further back over bare commas —
// `o teclado, o monitor e o laptop` sums all three.
function mateChain(
  sentence: Sentence,
  chunks: Sentence["chunks"],
  after: number,
  feat: string,
): readonly number[] {
  for (let j = after - 1; j >= 0; j--) {
    const chunk = chunks[j]!

    switch (chunk.kind === "NP" && nominalHead(sentence, chunk.head)) {
      case false:
        continue
      case true:
        break
    }

    switch (prepGoverned(sentence, chunk.from)) {
      case true:
        continue
      case false:
        break
    }

    switch (genderCompatible(sentence, chunk.head, feat)) {
      case false:
        return []
      case true:
        break
    }

    const mates = [chunk.head]

    for (let p = j - 1; p >= 0; p--) {
      const prev = chunks[p]!

      const chained =
        prev.kind === "NP" &&
        nominalHead(sentence, prev.head) &&
        onlyCommasBetween(sentence, prev.to, chunks[p + 1]!.from) &&
        genderCompatible(sentence, prev.head, feat)

      switch (chained) {
        case true:
          mates.unshift(prev.head)
          continue
        case false:
          break
      }

      break
    }

    return mates
  }

  return []
}

// Only the additive coordinator sums referents — `mas` and `ou` conjoin
// clauses and alternatives, never a plural's parts.
function additiveConjAt(sentence: Sentence, at: number): boolean {
  const token = sentence.tokens[at]

  switch (token === undefined) {
    case true:
      return false
    case false:
      break
  }

  switch (token!.role) {
    case "punctuation":
      return false
    case "content":
      break
  }

  switch (token!.tagged.pos === "CONJ") {
    case false:
      return false
    case true:
      break
  }

  switch (token!.tagged.token.text.toLowerCase()) {
    case "e":
    case "and":
      return true
    default:
      return false
  }
}

function prepGoverned(sentence: Sentence, from: number): boolean {
  for (let at = from - 1; at >= 0; at--) {
    const token = sentence.tokens[at]!

    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        return token.tagged.pos === "ADP"
    }
  }

  return false
}

function onlyCommasBetween(sentence: Sentence, from: number, to: number): boolean {
  for (let at = from; at < to; at++) {
    const token = sentence.tokens[at]!

    switch (token.role) {
      case "punctuation":
        continue
      case "content":
        return false
    }
  }

  return true
}

// A feminine plural demands feminine conjuncts, strictly — a gender-unknown
// name never passes. A masculine plural is the mixed-gender sum and accepts
// anything, matching how the language itself resolves.
function genderCompatible(sentence: Sentence, at: number, feat: string): boolean {
  switch (feat[0] === "f") {
    case false:
      return true
    case true:
      break
  }

  const token = sentence.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return token.tagged.feat[0] === "f"
  }
}

// The forward search cataphora uses: an agreeing SUBJECT after the pronoun
// in the same sentence — the matrix clause's, by the grammar of fronted
// subordinates.
function resolveForward(input: DiscourseInput, si: number, ti: number, feat: string): Optional<Anchor> {
  const sentence = input.sentences[si]!

  for (let at = ti + 1; at < sentence.tokens.length; at++) {
    switch (subjectTier(sentence, at) && agrees(sentence, at, feat)) {
      case true:
        return { kind: "some", value: { sentence: si, token: at } }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

function subjectTier(sentence: Sentence, at: number): boolean {
  return (
    nominalHead(sentence, at) &&
    sentence.relations.some((r) => r.kind === "subject-of" && r.dependent === at)
  )
}

function argumentTier(sentence: Sentence, at: number): boolean {
  return (
    nominalHead(sentence, at) &&
    sentence.relations.some(
      (r) =>
        (r.kind === "object-of" || r.kind === "dative-of" || r.kind === "oblique-of") &&
        r.dependent === at,
    )
  )
}

function anyTier(sentence: Sentence, at: number): boolean {
  return nominalHead(sentence, at)
}

function nominalHead(sentence: Sentence, at: number): boolean {
  const token = sentence.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      break
  }

  switch (token.tagged.pos === "NOUN" || token.tagged.pos === "PROPN") {
    case false:
      return false
    case true:
      return sentence.chunks.some((c) => c.head === at)
  }
}

const AGREEMENT_FEAT = /^[mf][sp]/

function agrees(sentence: Sentence, at: number, feat: string): boolean {
  switch (feat === "") {
    case true:
      return true
    case false:
      break
  }

  const token = sentence.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      break
  }

  const candidate = token.tagged.feat

  switch (AGREEMENT_FEAT.test(candidate)) {
    case true:
      return candidate[0] === feat[0] && candidate[1] === feat[1]
    case false:
      break
  }

  // A capitalized name the dictionary carries no gender for (guessed PROPN,
  // shape-guessed NOUN — Mizoguchi, Kirie) is gender-UNKNOWN: it matches any
  // singular pronoun rather than being skipped on a guess. Names with
  // dictionary gender (Daniela fs) still discriminate above.
  const nameish =
    /^[A-ZÀ-Ý]/.test(token.tagged.token.text) &&
    (token.tagged.pos === "PROPN" || token.tagged.pos === "NOUN")

  switch (nameish) {
    case false:
      return false
    case true:
      return feat[1] === "s"
  }
}

// The nearest preceding subject: the current sentence's last subject-of
// dependent before the pronoun, else each earlier sentence's last subject.
function nearestSubjectAnchor(input: DiscourseInput, si: number, ti: number): Optional<Anchor> {
  const current = input.sentences[si]!

  let best: Optional<number> = { kind: "none" }

  for (const r of current.relations) {
    switch (r.kind === "subject-of" && r.dependent < ti) {
      case true:
        best = { kind: "some", value: r.dependent }
        continue
      case false:
        continue
    }
  }

  switch (best.kind) {
    case "some":
      return { kind: "some", value: { sentence: si, token: best.value } }
    case "none":
      break
  }

  return resolveSubjectAntecedent(input, si)
}

// ─── first-person continuity ─────────────────────────────────────────────────
// A subjectless verb marked 1st person continues the narrator: when an
// authored first-person mention (`{Eu}[Narrador]`) stands earlier in the
// paragraph, the verb links to it — one alias glyph then covers the
// paragraph, instead of one per sentence.
function linkFirstPerson(links: DiscourseLink[], input: DiscourseInput, si: number): void {
  const sentence = input.sentences[si]!

  switch (sentence.attribution.kind) {
    case "narration":
      break
    case "speech":
      return
    case "written":
      return
  }

  for (const chunk of sentence.chunks) {
    switch (chunk.kind) {
      case "VP":
        break
      case "NP":
        continue
      case "PP":
        continue
    }

    // `includes("1")` alone: the merged I13s feats are person-AMBIGUOUS, and
    // an {Eu} mention in scope resolves them to the narrator — the pass runs
    // before 3rd-person continuity exactly so this claim wins.
    const feat = featAt(sentence, chunk.head)
    const firstPerson =
      input.syntax.verbFeats.finitePrefixes.some((p) => feat.startsWith(p)) && feat.includes("1")

    switch (firstPerson) {
      case false:
        continue
      case true:
        break
    }

    const subjected = sentence.relations.some((r) => r.kind === "subject-of" && r.head === chunk.head)

    switch (subjected) {
      case true:
        continue
      case false:
        break
    }

    const mention = nearestFirstPersonMention(input, si, chunk.head)

    switch (mention.kind) {
      case "none":
        continue
      case "some":
        links.push({
          kind: "elided-subject",
          fromSentence: si,
          fromToken: chunk.head,
          toSentence: mention.value.sentence,
          toToken: mention.value.token,
          provenance: "discourse",
        })
        continue
    }
  }
}

const FIRST_PERSON_SURFACES = ["eu", "i"]

// The nearest RESOLVED subject-mention whose covered text is a 1st-person
// pronoun, at or before (si, before) — nearest sentence first, latest token
// first.
function nearestFirstPersonMention(input: DiscourseInput, si: number, before: number): Optional<Anchor> {
  let best: Optional<Anchor> = { kind: "none" }

  for (const anchored of input.spans) {
    const anchor = firstPersonMentionAnchor(input, anchored)

    switch (anchor.kind) {
      case "none":
        continue
      case "some":
        break
    }

    const at = anchor.value

    const precedes = at.sentence < si || (at.sentence === si && at.token < before)

    switch (precedes) {
      case false:
        continue
      case true:
        break
    }

    switch (best.kind === "none" || laterAnchor(at, (best as { value: Anchor }).value)) {
      case true:
        best = { kind: "some", value: at }
        continue
      case false:
        continue
    }
  }

  return best
}

function laterAnchor(a: Anchor, b: Anchor): boolean {
  switch (a.sentence === b.sentence) {
    case true:
      return a.token > b.token
    case false:
      return a.sentence > b.sentence
  }
}

function firstPersonMentionAnchor(input: DiscourseInput, anchored: AnchoredSpan): Optional<Anchor> {
  switch (anchored.span.kind === "subject-mention" && anchored.span.binding.kind === "resolved") {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  switch (anchored.anchor.kind) {
    case "detached":
      return { kind: "none" }
    case "in-sentence":
      break
  }

  const sentence = input.sentences[anchored.anchor.sentence]
  const token = anchored.anchor.tokens[0]

  switch (sentence === undefined || token === undefined) {
    case true:
      return { kind: "none" }
    case false:
      break
  }

  const covered = sentence!.tokens[token!]!

  switch (covered.role) {
    case "punctuation":
      return { kind: "none" }
    case "content":
      break
  }

  switch (FIRST_PERSON_SURFACES.includes(covered.tagged.token.text.toLowerCase())) {
    case false:
      return { kind: "none" }
    case true:
      return { kind: "some", value: { sentence: anchored.anchor.sentence, token: token! } }
  }
}

// ─── coreference ─────────────────────────────────────────────────────────────
// Definiteness chains, paragraph-local: an NP opening on an indefinite
// article INTRODUCES its head lemma; a later NP opening on a definite article
// with the same head lemma RESUMES it. `Havia um poço no quintal. O poço
// estava seco.` — one well.
function linkCoreference(links: DiscourseLink[], input: DiscourseInput): void {
  const introduced = new Map<string, Anchor>()

  input.sentences.forEach((sentence, si) => {
    for (const chunk of sentence.chunks) {
      switch (chunk.kind) {
        case "NP":
          break
        case "VP":
          continue
        case "PP":
          continue
      }

      const opener = sentence.tokens[chunk.from]!

      switch (opener.role) {
        case "punctuation":
          continue
        case "content":
          break
      }

      const head = sentence.tokens[chunk.head]!

      switch (head.role === "content" && head.tagged.pos === "NOUN") {
        case false:
          continue
        case true:
          break
      }

      const article = opener.tagged.token.text.toLowerCase()
      const lemma = (head as { tagged: { lemma: string } }).tagged.lemma

      switch (input.syntax.indefiniteArticles.includes(article)) {
        case true:
          introduced.set(lemma, { sentence: si, token: chunk.head })
          continue
        case false:
          break
      }

      switch (input.syntax.definiteArticles.includes(article) && introduced.has(lemma)) {
        case true: {
          const to = introduced.get(lemma)!

          links.push({
            kind: "coreference",
            fromSentence: si,
            fromToken: chunk.head,
            toSentence: to.sentence,
            toToken: to.token,
            provenance: "discourse",
          })
          continue
        }
        case false:
          continue
      }
    }
  })
}

type Anchor = { sentence: number; token: number }

// ─── cross-paragraph continuity ──────────────────────────────────────────────
// The paragraph is the basic block; this is the block-boundary pass the
// driver runs over ADJACENT paragraph pairs. Deliberately narrower than the
// in-paragraph rules: only the new paragraph's FIRST sentence continues
// subjects, objects and pronouns backward (a paragraph break is a discourse
// boundary, and reaching deeper than its opening sentence is guesswork) —
// except the narrator: a 1st-person verb anywhere continues the nearest
// `{Eu}`-style mention of the PREVIOUS paragraph when its own has none, so
// one alias glyph covers the paragraphs that follow it. Returned links'
// `toSentence`/`toToken` index into the PREVIOUS paragraph; `claimed` is the
// current paragraph's own discourse output, so nothing resolved locally is
// re-resolved across the boundary.
export function linkAcrossParagraphs(
  prev: DiscourseInput,
  curr: DiscourseInput,
  claimed: readonly DiscourseLink[],
): readonly DiscourseLink[] {
  const links: DiscourseLink[] = []
  const first = curr.sentences[0]

  switch (first === undefined || prev.sentences.length === 0) {
    case true:
      return links
    case false:
      break
  }

  const taken = (kind: DiscourseLinkKind, si: number, ti: number): boolean =>
    hasLink(claimed, kind, si, ti) || hasLink(links, kind, si, ti)

  const continuity = subjectlessThirdVerbs(first!, curr.syntax)

  switch (continuity.length === 1 && subjectlessVpCount(first!) === 1) {
    case true: {
      const verb = continuity[0]!

      switch (taken("elided-subject", 0, verb)) {
        case true:
          break
        case false: {
          const antecedent = resolveSubjectAntecedent(prev, prev.sentences.length)

          switch (antecedent.kind) {
            case "some":
              links.push({
                kind: "elided-subject",
                fromSentence: 0,
                fromToken: verb,
                toSentence: antecedent.value.sentence,
                toToken: antecedent.value.token,
                provenance: "discourse",
              })
              break
            case "none":
              break
          }
        }
      }
      break
    }
    case false:
      break
  }

  for (const verb of objectlessTransitiveVerbs(first!, curr.syntax)) {
    switch (taken("elided-object", 0, verb)) {
      case true:
        continue
      case false:
        break
    }

    const antecedent = crossAntecedent(prev)

    switch (antecedent.kind) {
      case "none":
        continue
      case "some":
        links.push({
          kind: "elided-object",
          fromSentence: 0,
          fromToken: verb,
          toSentence: antecedent.value.sentence,
          toToken: antecedent.value.token,
          provenance: "discourse",
        })
        continue
    }
  }

  // Definiteness chains continue over the break: an entity the previous
  // paragraph introduced with an indefinite is resumed by the new
  // paragraph's opening definite NP.
  for (const chunk of first!.chunks) {
    switch (chunk.kind === "NP") {
      case false:
        continue
      case true:
        break
    }

    const opener = first!.tokens[chunk.from]!
    const head = first!.tokens[chunk.head]!

    const definite =
      opener.role === "content" &&
      head.role === "content" &&
      head.tagged.pos === "NOUN" &&
      curr.syntax.definiteArticles.includes(opener.tagged.token.text.toLowerCase())

    switch (definite && taken("coreference", 0, chunk.head) === false) {
      case false:
        continue
      case true:
        break
    }

    const lemma = (head as { tagged: { lemma: string } }).tagged.lemma
    const introduced = lastIntroduction(prev, lemma)

    switch (introduced.kind) {
      case "none":
        continue
      case "some":
        links.push({
          kind: "coreference",
          fromSentence: 0,
          fromToken: chunk.head,
          toSentence: introduced.value.sentence,
          toToken: introduced.value.token,
          provenance: "discourse",
        })
        continue
    }
  }

  first!.tokens.forEach((token, ti) => {
    switch (token.role) {
      case "punctuation":
        return
      case "content":
        break
    }

    const hint = curr.syntax.anaphoricPronouns.find((a) => a.form === token.tagged.token.text.toLowerCase())

    switch (hint === undefined || taken("anaphora", 0, ti)) {
      case true:
        return
      case false:
        break
    }

    const last = prev.sentences.length - 1
    const antecedent = resolveAgreeing(prev, last, prev.sentences[last]!.tokens.length, hint!.feat)

    switch (antecedent.kind) {
      case "some":
        links.push(anaphoraLink(0, ti, antecedent.value))
        return
      case "none":
        return
    }
  })

  curr.sentences.forEach((sentence, si) => {
    switch (sentence.attribution.kind) {
      case "narration":
        break
      case "speech":
        return
      case "written":
        return
    }

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
      const firstPerson =
        curr.syntax.verbFeats.finitePrefixes.some((p) => feat.startsWith(p)) && feat.includes("1")

      const subjected = sentence.relations.some((r) => r.kind === "subject-of" && r.head === chunk.head)

      const local = nearestFirstPersonMention(curr, si, chunk.head)

      const continues =
        firstPerson && subjected === false && local.kind === "none" && taken("elided-subject", si, chunk.head) === false

      switch (continues) {
        case false:
          continue
        case true:
          break
      }

      const mention = nearestFirstPersonMention(prev, prev.sentences.length, 0)

      switch (mention.kind) {
        case "none":
          continue
        case "some":
          links.push({
            kind: "elided-subject",
            fromSentence: si,
            fromToken: chunk.head,
            toSentence: mention.value.sentence,
            toToken: mention.value.token,
            provenance: "discourse",
          })
          continue
      }
    }
  })

  return links
}

function hasLink(all: readonly DiscourseLink[], kind: DiscourseLinkKind, si: number, ti: number): boolean {
  return all.some((l) => l.kind === kind && l.fromSentence === si && l.fromToken === ti)
}

// The last indefinite-introduced NP with this head lemma anywhere in the
// previous paragraph.
function lastIntroduction(prev: DiscourseInput, lemma: string): Optional<Anchor> {
  let best: Optional<Anchor> = { kind: "none" }

  prev.sentences.forEach((sentence, si) => {
    for (const chunk of sentence.chunks) {
      switch (chunk.kind === "NP") {
        case false:
          continue
        case true:
          break
      }

      const opener = sentence.tokens[chunk.from]!
      const head = sentence.tokens[chunk.head]!

      const introduces =
        opener.role === "content" &&
        head.role === "content" &&
        head.tagged.pos === "NOUN" &&
        head.tagged.lemma === lemma &&
        prev.syntax.indefiniteArticles.includes(opener.tagged.token.text.toLowerCase())

      switch (introduces) {
        case true:
          best = { kind: "some", value: { sentence: si, token: chunk.head } }
          continue
        case false:
          continue
      }
    }
  })

  return best
}

// The previous paragraph's freshest referent: its last sentence's last
// object, else subject, walking backward.
function crossAntecedent(prev: DiscourseInput): Optional<Anchor> {
  for (let sj = prev.sentences.length - 1; sj >= 0; sj--) {
    const sentence = prev.sentences[sj]!

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
        return { kind: "some", value: { sentence: sj, token: subject.value } }
    }
  }

  return { kind: "none" }
}

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

    // A contested verb reading is a guess, and a guess is not evidence of
    // an elided subject.
    switch (contestedAt(sentence, chunk.head)) {
      case true:
        continue
      case false:
        break
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

    // Meteorological verbs are impersonal: `Rei chegou. Chovia.` continues
    // no one — Rei does not rain.
    switch (syntax.weatherVerbs.includes(lemmaAt(sentence, chunk.head))) {
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

    switch (contestedAt(sentence, chunk.head)) {
      case true:
        continue
      case false:
        break
    }

    const expects = expectsObject(lemmaAt(sentence, chunk.head), syntax.valency)
    const found = sentence.relations.some((r) => claimsObject(r, chunk.head))

    const excused =
      isPassiveParticiple(sentence, chunk.head, syntax) || invertedQuotative(sentence, chunk.head, syntax)

    switch (expects && found === false && excused === false) {
      case true:
        out.push(chunk.head)
        continue
      case false:
        continue
    }
  }

  return out
}

// An inverted attribution (`..., dizia Rei`) quotes, it does not elide: the
// dicendi verb's content is the quoted matrix clause itself, so a verb of
// saying whose subject stands AFTER it claims no discourse antecedent.
function invertedQuotative(sentence: Sentence, head: number, syntax: SyntaxData): boolean {
  switch (syntax.dicendi.includes(lemmaAt(sentence, head))) {
    case false:
      return false
    case true:
      break
  }

  return sentence.relations.some((r) => r.kind === "subject-of" && r.head === head && r.dependent > head)
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

function contestedAt(sentence: Sentence, index: number): boolean {
  const token = sentence.tokens[index]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return token.tagged.provenance === "contested"
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
    // The se-construction claims its verb: `abraçaram-se` and `vivia-se bem`
    // elide nothing.
    case "reflexive-of":
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
    case "oblique-of":
      return false
    case "dative-of":
      return false
    case "particle-of":
      return false
    case "vocative-of":
      return false
    case "appositive-of":
      return false
    case "compared-to":
      return false
    case "temporal-of":
      return false
    case "adverbial-of":
      return false
    case "light-verb-of":
      return false
    case "advmod-of":
      return false
    case "degree-of":
      return false
    case "predicative-of":
      return false
    case "role-of":
      return false
    case "purpose-of":
      return false
    case "duration-of":
      return false
    case "focus-of":
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
