// The driver. A book is the program, its paragraphs the translation units:
// the driver parses the book's own surface (markdown blocks, frontmatter,
// cast, glyphs), selects the target dictionary from the declared language,
// runs the front-end pipeline once per paragraph, and collects every unit's
// IR plus its debug info — chapter, line and column for each sentence, the
// coordinates every downstream fact points back to. Unresolved character
// names surface here as the compilation's diagnostics. It is the seam the
// main-process backend persists, so it stays pure and is unit-tested against
// the real dictionaries.
//
// Coordinates: scanGlyphs lifts each line's spans to doc-absolute offsets by
// advancing one character per joining newline. A paragraph's text is therefore
// its lines joined by "\n", and a doc-absolute span is re-based onto that text by
// subtracting the paragraph's start offset — the two coordinate systems line up
// exactly because both count the newline as one character.

import { buildCast } from "../book/cast"
import type { Cast } from "../book/cast"
import type { Binding, GlyphSpan, LineSpan } from "../book/glyphs"
import { scanGlyphs } from "../book/glyphs"
import { chapterAtLine, chapterList } from "../book/outline"
import type { Chapter } from "../book/outline"
import { parseBookDoc } from "../book/parse"
import type { Block } from "../book/parse"
import type { Optional } from "../optional"
import { err, ok } from "../result"
import type { Result } from "../result"
import { analyzeParagraph } from "./pipeline"
import type { ParagraphAnalysis, Sentence } from "./pipeline"
import { linkAcrossParagraphs } from "./dataflow"
import type { DiscourseLinkKind, DiscourseProvenance } from "./dataflow"
import type { TimelineEdgeKind, TimelineEvent, TimelineProvenance } from "./timeline"
import { readLanguage } from "./language"
import type { Language } from "./language"
import type { Lexicon } from "./lexicon"

// Where a sentence sits in the book: its enclosing chapter (1-based
// auto-number plus title, none before the first `##` heading) and the 1-based
// doc line and column of the sentence's first character.
export type ChapterPlace = { index: number; title: string }

export type SentenceLocation = {
  chapter: Optional<ChapterPlace>
  line: number
  col: number
}

// `locations` is index-aligned with `analysis.sentences`: sentence i of this
// paragraph was found at locations[i].
export type ParagraphSlot = {
  index: number
  fromLine: number
  toLine: number
  analysis: ParagraphAnalysis
  locations: readonly SentenceLocation[]
}

// A discourse link crossing a paragraph boundary — the block-boundary edges
// the per-paragraph dataflow pass cannot carry. Both endpoints name their
// paragraph explicitly.
export type BookLink = {
  kind: DiscourseLinkKind
  fromParagraph: number
  fromSentence: number
  fromToken: number
  toParagraph: number
  toSentence: number
  toToken: number
  provenance: DiscourseProvenance
}

// A timeline edge crossing a paragraph boundary: the last perfective of one
// paragraph precedes the first perfective of the next — the narrative
// convention carried over the block break.
export type BookTimelineEdge = {
  kind: TimelineEdgeKind
  fromParagraph: number
  fromSentence: number
  fromToken: number
  toParagraph: number
  toSentence: number
  toToken: number
  provenance: TimelineProvenance
}

// A proper name outside the cast, typed by ORDERED evidence — strongest rule
// that fires wins, and nothing firing stays honestly unknown:
//   1. person — the name SAYS something (subject of a dicendi verb), is
//      ADDRESSED (vocative), or wears an honorific title (Sr. Tanabe);
//   2. typed — a declared head noun claims it by grammar, with its kind:
//      `a cidade de S` place, `o gato Hellmanns` animal, `a banda X`
//      organization, `o detetive Y` person;
//   3. place — a locative adposition governs it (`no B Bar`), unless the
//      mention sits inside quote marks (a quoted title names no geography).
export type EntityKind = "person" | "animal" | "organization" | "place" | "unknown"

export type NamedEntity = {
  name: string
  kind: EntityKind
  mentions: number
}

export type BookAnalysis = {
  language: Language
  cast: Cast
  paragraphs: readonly ParagraphSlot[]
  spans: readonly GlyphSpan[]
  unresolved: readonly string[]
  bookLinks: readonly BookLink[]
  entities: readonly NamedEntity[]
  timelineEdges: readonly BookTimelineEdge[]
  // Descriptions the text itself equates with cast members (`Rei, o
  // detetive` / `o detetive Rei`) — the alias registry definite descriptions
  // resolve through.
  aliases: readonly CharacterAlias[]
  aliasMentions: readonly AliasMention[]
  // Unattributed dialogue turns guessed by ALTERNATION: in a run between
  // exactly two attributed speakers, consecutive turns alternate.
  turnGuesses: readonly TurnGuess[]
}

export type CharacterAlias = {
  slug: string
  description: string
}

// A definite description RESOLVED through the alias registry: once the text
// says `Rei, o detetive`, every later `o detetive` is Rei — epithet
// coreference grounded entirely in the book's own words. Ambiguous
// descriptions (two characters sharing one) resolve no one.
export type AliasMention = {
  paragraph: number
  sentence: number
  token: number
  slug: string
}

export type TurnGuess = {
  paragraph: number
  slug: string
}

export type BookAnalysisError = { kind: "lexicon-unavailable"; language: Language }

// The engine's injected view of the loaded lexicons: a book's language selects
// its dictionary, or none when that dictionary failed to load.
export type LexiconSource = (language: Language) => Optional<Lexicon>

export function analyzeBook(
  content: string,
  source: LexiconSource,
): Result<BookAnalysis, BookAnalysisError> {
  const lines = content.split("\n")
  const doc = parseBookDoc(lines)
  const language = readLanguage(doc)

  const lexicon = source(language)

  switch (lexicon.kind) {
    case "none":
      return err({ kind: "lexicon-unavailable", language })
    case "some":
      break
  }

  const cast = buildCast(doc)
  const spans = scanGlyphs(lines, cast)
  const starts = lineStarts(lines)
  const chapters = chapterList(doc)

  const paragraphs = paragraphBlocks(doc.blocks).map((block, index) =>
    analyzeSlot(block, index, lines, spans, starts, chapters, lexicon.value, language),
  )

  const aliases = collectAliases(paragraphs, cast)

  return ok({
    language,
    cast,
    paragraphs,
    spans,
    unresolved: unresolvedNames(spans),
    bookLinks: crossParagraphLinks(paragraphs, lexicon.value),
    entities: nameEntities(paragraphs, cast, lexicon.value),
    timelineEdges: stitchTimelines(paragraphs),
    aliases,
    aliasMentions: resolveAliasMentions(paragraphs, aliases, lexicon.value),
    turnGuesses: guessTurns(paragraphs, cast),
  })
}

// Later definite descriptions resolve through the registry: a definite NP
// whose head lemma is a UNIQUELY-owned alias points at its character — the
// defining appositive itself is excluded.
function resolveAliasMentions(
  paragraphs: readonly ParagraphSlot[],
  aliases: readonly CharacterAlias[],
  lexicon: Lexicon,
): readonly AliasMention[] {
  const owners = new Map<string, string | null>()

  for (const alias of aliases) {
    const existing = owners.get(alias.description)

    switch (existing === undefined) {
      case true:
        owners.set(alias.description, alias.slug)
        break
      case false:
        switch (existing === alias.slug) {
          case true:
            break
          case false:
            owners.set(alias.description, null)
            break
        }
        break
    }
  }

  const out: AliasMention[] = []

  for (const slot of paragraphs) {
    slot.analysis.sentences.forEach((sentence, si) => {
      for (const chunk of sentence.chunks) {
        switch (chunk.kind === "NP") {
          case false:
            continue
          case true:
            break
        }

        const opener = sentence.tokens[chunk.from]!
        const head = sentence.tokens[chunk.head]!

        const definite =
          opener.role === "content" &&
          head.role === "content" &&
          head.tagged.pos === "NOUN" &&
          lexicon.syntax.definiteArticles.includes(opener.tagged.token.text.toLowerCase())

        switch (definite) {
          case false:
            continue
          case true:
            break
        }

        const slug = owners.get((head as { tagged: { lemma: string } }).tagged.lemma)

        switch (slug === undefined || slug === null) {
          case true:
            continue
          case false:
            break
        }

        const defining = sentence.relations.some(
          (r) => r.kind === "appositive-of" && r.dependent === chunk.head,
        )

        switch (defining) {
          case true:
            continue
          case false:
            out.push({ paragraph: slot.index, sentence: si, token: chunk.head, slug: slug! })
            continue
        }
      }
    })
  }

  return out
}

// Appositives whose NAME side is a cast member register the description as
// an alias: `Rei, o detetive` and `o detetive Rei` both put "detetive" in
// Rei's registry.
function collectAliases(paragraphs: readonly ParagraphSlot[], cast: Cast): readonly CharacterAlias[] {
  const names = new Map(cast.characters.map((c) => [c.name, c.slug]))
  const seen = new Set<string>()
  const out: CharacterAlias[] = []

  for (const slot of paragraphs) {
    for (const sentence of slot.analysis.sentences) {
      for (const r of sentence.relations) {
        switch (r.kind === "appositive-of") {
          case false:
            continue
          case true:
            break
        }

        const name = wordExact(sentence, r.head)
        const slug = name === null ? undefined : names.get(name)

        switch (slug === undefined) {
          case true:
            continue
          case false:
            break
        }

        const description = lemmaOf(sentence, r.dependent)
        const key = `${slug} ${description}`

        switch (description.length === 0 || seen.has(key)) {
          case true:
            continue
          case false:
            seen.add(key)
            out.push({ slug: slug!, description })
            continue
        }
      }
    }
  }

  return out
}

function wordExact(sentence: Sentence, index: number): string | null {
  const token = sentence.tokens[index]

  switch (token === undefined) {
    case true:
      return null
    case false:
      break
  }

  switch (token!.role) {
    case "content":
      return token!.tagged.token.text
    case "punctuation":
      return null
  }
}

// Dialogue alternation: within a run of consecutive speech paragraphs whose
// attributed speakers are EXACTLY two people, an unattributed turn takes the
// speaker its distance-parity from the nearest attributed turn implies —
// adjacent turns alternate.
function guessTurns(paragraphs: readonly ParagraphSlot[], cast: Cast): readonly TurnGuess[] {
  const out: TurnGuess[] = []

  let run: { index: number; slug: string | null }[] = []

  const close = (): void => {
    const attributed = run.filter((t) => t.slug !== null).map((t) => t.slug!)
    let distinct = [...new Set(attributed)]

    // One attributed speaker and a TWO-member cast still pins the dialogue:
    // the other voice can only be the other character.
    switch (distinct.length === 1 && cast.characters.length === 2) {
      case true: {
        const other = cast.characters.find((c) => c.slug !== distinct[0])

        switch (other === undefined) {
          case true:
            break
          case false:
            distinct = [distinct[0]!, other!.slug]
            break
        }
        break
      }
      case false:
        break
    }

    switch (distinct.length === 2) {
      case false:
        run = []
        return
      case true:
        break
    }

    run.forEach((turn, i) => {
      switch (turn.slug === null) {
        case false:
          return
        case true:
          break
      }

      const anchor = nearestAttributed(run, i)

      switch (anchor.kind) {
        case "none":
          return
        case "some": {
          const { slug, distance } = anchor.value
          const other = distinct[0] === slug ? distinct[1]! : distinct[0]!

          out.push({ paragraph: turn.index, slug: distance % 2 === 1 ? other : slug })
          return
        }
      }
    })

    run = []
  }

  for (const slot of paragraphs) {
    const first = slot.analysis.sentences[0]

    const speech = first !== undefined && first.attribution.kind === "speech"

    switch (speech) {
      case false:
        close()
        continue
      case true:
        break
    }

    const attribution = first!.attribution as { kind: "speech"; speaker: { kind: string; slug?: string } }
    const slug = attribution.speaker.kind === "slug" ? attribution.speaker.slug! : null

    run.push({ index: slot.index, slug })
  }

  close()

  return out
}

function nearestAttributed(
  run: readonly { slug: string | null }[],
  i: number,
): Optional<{ slug: string; distance: number }> {
  for (let d = 1; d < run.length; d++) {
    const before = run[i - d]
    const after = run[i + d]

    switch (before !== undefined && before!.slug !== null) {
      case true:
        return { kind: "some", value: { slug: before!.slug!, distance: d } }
      case false:
        break
    }

    switch (after !== undefined && after!.slug !== null) {
      case true:
        return { kind: "some", value: { slug: after!.slug!, distance: d } }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

// The narrative chain over block boundaries: adjacent paragraphs' perfective
// anchors join with a before-edge — the same advancement rule, one level up.
// A CHAPTER break is a legitimate time jump and never auto-stitches.
function stitchTimelines(paragraphs: readonly ParagraphSlot[]): readonly BookTimelineEdge[] {
  const out: BookTimelineEdge[] = []

  for (let i = 1; i < paragraphs.length; i++) {
    const prev = paragraphs[i - 1]!
    const curr = paragraphs[i]!

    switch (sameChapter(prev, curr)) {
      case false:
        continue
      case true:
        break
    }

    const from = lastPerfective(prev.analysis.timeline.events)
    const to = firstPerfective(curr.analysis.timeline.events)

    switch (from.kind === "some" && to.kind === "some") {
      case false:
        continue
      case true:
        break
    }

    const a = (from as { value: TimelineEvent }).value
    const b = (to as { value: TimelineEvent }).value

    out.push({
      kind: "before",
      fromParagraph: prev.index,
      fromSentence: a.sentence,
      fromToken: a.token,
      toParagraph: curr.index,
      toSentence: b.sentence,
      toToken: b.token,
      provenance: "narrative-advance",
    })
  }

  return out
}

function sameChapter(a: ParagraphSlot, b: ParagraphSlot): boolean {
  return chapterIndexOf(a) === chapterIndexOf(b)
}

function chapterIndexOf(slot: ParagraphSlot): number {
  const location = slot.locations[0]

  switch (location === undefined) {
    case true:
      return -1
    case false:
      break
  }

  switch (location!.chapter.kind) {
    case "none":
      return -1
    case "some":
      return location!.chapter.value.index
  }
}

function firstPerfective(events: readonly TimelineEvent[]): Optional<TimelineEvent> {
  for (const event of events) {
    switch (event.lane === "narrative" && event.effect === "perfective") {
      case true:
        return { kind: "some", value: event }
      case false:
        continue
    }
  }

  return { kind: "none" }
}

function lastPerfective(events: readonly TimelineEvent[]): Optional<TimelineEvent> {
  let best: Optional<TimelineEvent> = { kind: "none" }

  for (const event of events) {
    switch (event.lane === "narrative" && event.effect === "perfective") {
      case true:
        best = { kind: "some", value: event }
        continue
      case false:
        continue
    }
  }

  return best
}

// Every proper-noun NP outside the cast, aggregated by surface name; each
// mention contributes ORDERED evidence and the strongest kind ever seen
// decides. Mentions inside quote marks contribute no evidence at all — a
// quoted title names no one and no place.
type EntityEvidence = { mentions: number; person: number; typed: Map<EntityKind, number>; locative: number }

function nameEntities(paragraphs: readonly ParagraphSlot[], cast: Cast, lexicon: Lexicon): readonly NamedEntity[] {
  const castNames = new Set(cast.characters.map((c) => c.name))
  const tally = new Map<string, EntityEvidence>()

  for (const slot of paragraphs) {
    for (const sentence of slot.analysis.sentences) {
      for (const chunk of sentence.chunks) {
        const name = properName(sentence, chunk)

        switch (name.kind) {
          case "none":
            continue
          case "some":
            break
        }

        switch (castNames.has(name.value) || partOfCast(name.value, castNames)) {
          case true:
            continue
          case false:
            break
        }

        // A bare honorific is not an entity — `Sr.` names no one on its own.
        switch (lexicon.syntax.personTitles.some((t) => t === name.value)) {
          case true:
            continue
          case false:
            break
        }

        const entry = tally.get(name.value) ?? { mentions: 0, person: 0, typed: new Map<EntityKind, number>(), locative: 0 }
        entry.mentions += 1

        switch (insideQuotes(sentence, chunk.from)) {
          case true:
            tally.set(name.value, entry)
            continue
          case false:
            break
        }

        entry.person += personEvidence(sentence, chunk, lexicon.syntax) ? 1 : 0

        const typed = typedKindEvidence(sentence, chunk, lexicon.syntax)

        switch (typed.kind) {
          case "some":
            entry.typed.set(typed.value, (entry.typed.get(typed.value) ?? 0) + 1)
            break
          case "none":
            break
        }

        entry.locative += locativeBefore(sentence, chunk, lexicon.syntax.locativeMarkers) ? 1 : 0
        tally.set(name.value, entry)
      }
    }
  }

  const out: NamedEntity[] = []

  for (const [name, entry] of tally) {
    out.push({ name, kind: entityKind(entry), mentions: entry.mentions })
  }

  return out
}

// Strict precedence, never a vote count: a name that SPEAKS is a person no
// matter how often it is travelled to; among typed-head kinds the
// most-attested one wins.
function entityKind(entry: EntityEvidence): EntityKind {
  switch (entry.person > 0) {
    case true:
      return "person"
    case false:
      break
  }

  let best: EntityKind = "unknown"
  let bestCount = 0

  for (const [kind, count] of entry.typed) {
    switch (count > bestCount) {
      case true:
        best = kind
        bestCount = count
        break
      case false:
        break
    }
  }

  switch (bestCount > 0) {
    case true:
      return best
    case false:
      break
  }

  switch (entry.locative > 0) {
    case true:
      return "place"
    case false:
      return "unknown"
  }
}

// The name says something (subject of a verb of saying), is addressed, or
// wears an honorific title.
function personEvidence(sentence: Sentence, chunk: { from: number; head: number }, syntax: Lexicon["syntax"]): boolean {
  // The title may sit one token back across its abbreviation period
  // (`Sr . Tanabe` after tokenization).
  const title = (at: number): boolean => {
    const word = wordOf(sentence, at)

    return word !== null && syntax.personTitles.some((t) => t.toLowerCase() === word)
  }

  switch (title(chunk.from - 1) || title(chunk.from - 2)) {
    case true:
      return true
    case false:
      break
  }

  for (const r of sentence.relations) {
    switch (r.kind === "vocative-of" && r.dependent === chunk.head) {
      case true:
        return true
      case false:
        break
    }

    const says =
      r.kind === "subject-of" &&
      r.dependent === chunk.head &&
      syntax.dicendi.includes(lemmaOf(sentence, r.head))

    switch (says) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// A typed head noun claims the name with its KIND: genitive (`a CIDADE de S`
// — head noun, then genitive marker, then the name), appositive (`S, uma
// CIDADE fria`) or title compound (`o GATO Hellmanns`).
function typedKindEvidence(
  sentence: Sentence,
  chunk: { from: number; head: number },
  syntax: Lexicon["syntax"],
): Optional<EntityKind> {
  const marker = chunk.from - 1
  const head = chunk.from - 2

  const genitive =
    head >= 0 && wordOf(sentence, marker) !== null && syntax.genitiveMarkers.includes(wordOf(sentence, marker)!)

  switch (genitive) {
    case true: {
      const kind = headNounKind(lemmaOf(sentence, head), syntax)

      switch (kind.kind) {
        case "some":
          return kind
        case "none":
          break
      }
      break
    }
    case false:
      break
  }

  for (const r of sentence.relations) {
    switch (r.kind === "appositive-of" && r.head === chunk.head) {
      case false:
        continue
      case true:
        break
    }

    const kind = headNounKind(lemmaOf(sentence, r.dependent), syntax)

    switch (kind.kind) {
      case "some":
        return kind
      case "none":
        continue
    }
  }

  return { kind: "none" }
}

function headNounKind(lemma: string, syntax: Lexicon["syntax"]): Optional<EntityKind> {
  switch (syntax.personHeadNouns.includes(lemma)) {
    case true:
      return { kind: "some", value: "person" }
    case false:
      break
  }

  switch (syntax.animalHeadNouns.includes(lemma)) {
    case true:
      return { kind: "some", value: "animal" }
    case false:
      break
  }

  switch (syntax.organizationHeadNouns.includes(lemma)) {
    case true:
      return { kind: "some", value: "organization" }
    case false:
      break
  }

  switch (syntax.placeHeadNouns.includes(lemma)) {
    case true:
      return { kind: "some", value: "place" }
    case false:
      return { kind: "none" }
  }
}

// An odd number of quote marks before the chunk means it sits inside a
// quotation.
function insideQuotes(sentence: Sentence, before: number): boolean {
  let depth = 0

  for (let at = 0; at < before; at++) {
    const token = sentence.tokens[at]!

    switch (token.role) {
      case "content":
        continue
      case "punctuation":
        break
    }

    switch (isQuoteText(token.token.text)) {
      case true:
        depth += 1
        continue
      case false:
        continue
    }
  }

  return depth % 2 === 1
}

function isQuoteText(text: string): boolean {
  switch (text) {
    case "“":
      return true
    case "”":
      return true
    case "\"":
      return true
    case "«":
      return true
    case "»":
      return true
    default:
      return false
  }
}

function lemmaOf(sentence: Sentence, index: number): string {
  const token = sentence.tokens[index]

  switch (token === undefined) {
    case true:
      return ""
    case false:
      break
  }

  switch (token!.role) {
    case "content":
      return token!.tagged.lemma
    case "punctuation":
      return ""
  }
}

function wordOf(sentence: Sentence, index: number): string | null {
  const token = sentence.tokens[index]

  switch (token === undefined) {
    case true:
      return null
    case false:
      break
  }

  switch (token!.role) {
    case "content":
      return token!.tagged.token.text.toLowerCase()
    case "punctuation":
      return null
  }
}

// An NP whose every content token is a PROPN — the name is their joined text.
function properName(sentence: Sentence, chunk: { kind: string; from: number; to: number }): Optional<string> {
  switch (chunk.kind === "NP") {
    case false:
      return { kind: "none" }
    case true:
      break
  }

  const parts: string[] = []

  for (let at = chunk.from; at < chunk.to; at++) {
    const token = sentence.tokens[at]!

    switch (token.role) {
      case "punctuation":
        return { kind: "none" }
      case "content":
        break
    }

    switch (token.tagged.pos === "PROPN") {
      case false:
        return { kind: "none" }
      case true:
        parts.push(token.tagged.token.text)
        continue
    }
  }

  switch (parts.length === 0) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: parts.join(" ") }
  }
}

function partOfCast(name: string, castNames: ReadonlySet<string>): boolean {
  for (const cast of castNames) {
    switch (cast.includes(name)) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

function locativeBefore(
  sentence: Sentence,
  chunk: { from: number },
  markers: readonly string[],
): boolean {
  const at = chunk.from - 1

  switch (at >= 0) {
    case false:
      return false
    case true:
      break
  }

  const token = sentence.tokens[at]!

  switch (token.role) {
    case "punctuation":
      return false
    case "content":
      return markers.includes(token.tagged.token.text.toLowerCase())
  }
}

// The block-boundary pass: every adjacent paragraph pair runs the
// cross-paragraph continuity rules, and each returned link is lifted into
// book coordinates.
function crossParagraphLinks(paragraphs: readonly ParagraphSlot[], lexicon: Lexicon): readonly BookLink[] {
  const out: BookLink[] = []

  for (let i = 1; i < paragraphs.length; i++) {
    const prev = paragraphs[i - 1]!
    const curr = paragraphs[i]!

    // Continuity is chapter-local: a chapter break resets the discourse.
    switch (sameChapter(prev, curr)) {
      case false:
        continue
      case true:
        break
    }

    const links = linkAcrossParagraphs(
      { sentences: prev.analysis.sentences, spans: prev.analysis.spans, syntax: lexicon.syntax },
      { sentences: curr.analysis.sentences, spans: curr.analysis.spans, syntax: lexicon.syntax },
      curr.analysis.discourse,
    )

    for (const link of links) {
      out.push({
        kind: link.kind,
        fromParagraph: curr.index,
        fromSentence: link.fromSentence,
        fromToken: link.fromToken,
        toParagraph: prev.index,
        toSentence: link.toSentence,
        toToken: link.toToken,
        provenance: link.provenance,
      })
    }
  }

  return out
}

type ParagraphBlock = { fromLine: number; toLine: number }

function paragraphBlocks(blocks: readonly Block[]): readonly ParagraphBlock[] {
  const out: ParagraphBlock[] = []

  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph":
        out.push({ fromLine: block.fromLine, toLine: block.toLine })
        continue
      default:
        continue
    }
  }

  return out
}

function analyzeSlot(
  block: ParagraphBlock,
  index: number,
  lines: readonly string[],
  spans: readonly GlyphSpan[],
  starts: readonly number[],
  chapters: readonly Chapter[],
  lexicon: Lexicon,
  language: Language,
): ParagraphSlot {
  const base = starts[block.fromLine]!
  const text = lines.slice(block.fromLine, block.toLine + 1).join("\n")
  const local = spansInBlock(spans, block, base)

  const analysis = analyzeParagraph({ text, spans: local, lexicon, language })

  const locations = analysis.sentences.map((sentence) =>
    locate(base + sentence.source.from, block, starts, chapters),
  )

  return { index, fromLine: block.fromLine, toLine: block.toLine, analysis, locations }
}

// Doc-absolute offset of a sentence's first character -> its 1-based line and
// column plus enclosing chapter. The line is found inside the sentence's own
// paragraph block, whose line starts bracket every offset the analyzer yields.
function locate(
  offset: number,
  block: ParagraphBlock,
  starts: readonly number[],
  chapters: readonly Chapter[],
): SentenceLocation {
  let lineIdx = block.fromLine

  for (let li = block.fromLine; li <= block.toLine; li++) {
    switch (starts[li]! <= offset) {
      case true:
        lineIdx = li
        continue
      case false:
        continue
    }
  }

  return {
    chapter: placeOf(chapterAtLine(chapters, lineIdx), chapters),
    line: lineIdx + 1,
    col: offset - starts[lineIdx]! + 1,
  }
}

function placeOf(found: Optional<number>, chapters: readonly Chapter[]): Optional<ChapterPlace> {
  switch (found.kind) {
    case "none":
      return { kind: "none" }
    case "some":
      return { kind: "some", value: { index: found.value + 1, title: chapters[found.value]!.title } }
  }
}

function spansInBlock(
  spans: readonly GlyphSpan[],
  block: ParagraphBlock,
  base: number,
): readonly LineSpan[] {
  const out: LineSpan[] = []

  for (const span of spans) {
    switch (span.line >= block.fromLine && span.line <= block.toLine) {
      case true:
        out.push(rebase(span, base))
        continue
      case false:
        continue
    }
  }

  return out
}

// Doc-absolute glyph span -> paragraph-relative LineSpan: every offset drops the
// paragraph's start, and the `line` tag is discarded (the analyzer works in one
// paragraph's coordinates and never needs it).
function rebase(span: GlyphSpan, base: number): LineSpan {
  return {
    kind: span.kind,
    from: span.from - base,
    to: span.to - base,
    hidden: span.hidden.map((range) => ({ from: range.from - base, to: range.to - base })),
    text: span.text,
    binding: span.binding,
  }
}

// Doc-absolute start offset of every line: line i begins after all earlier lines
// and their joining newlines, the same arithmetic scanGlyphs lifts spans with.
function lineStarts(lines: readonly string[]): readonly number[] {
  const starts: number[] = []
  let offset = 0

  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  return starts
}

// Every distinct name an author mentioned that binds to no declared character,
// in first-seen order — the unresolved references the store records alongside the
// resolved cast.
function unresolvedNames(spans: readonly GlyphSpan[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const span of spans) {
    const name = unresolvedOf(span.binding)

    switch (name.kind) {
      case "none":
        continue
      case "some":
        break
    }

    switch (seen.has(name.value)) {
      case true:
        continue
      case false:
        seen.add(name.value)
        out.push(name.value)
        continue
    }
  }

  return out
}

function unresolvedOf(binding: Binding): Optional<string> {
  switch (binding.kind) {
    case "unresolved":
      return { kind: "some", value: binding.name }
    case "resolved":
      return { kind: "none" }
    case "unknown":
      return { kind: "none" }
  }
}
