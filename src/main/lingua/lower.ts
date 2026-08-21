// Lowering: the front end's tree-shaped IR (BookAnalysis) flattened to the
// backend's relational rows. Pure — no sqlite here: this maps the analysis
// tree to flat, insertable records and is unit-tested on its own, so the
// emitter (store.ts) only has to bind these rows to prepared statements.
// Token indices are kept faithful to the analysis' own per-sentence token
// array — punctuation included — so chunk heads and relation endpoints in
// the DB reference exactly the token rows they mean.

import type { Attribution, Sentence, Speaker } from "../../shared/lingua/pipeline"
import type { BookAnalysis, ChapterPlace, SentenceLocation } from "../../shared/lingua/driver"
import type { Binding, GlyphSpan } from "../../shared/book/glyphs"
import type { AnalyzedToken } from "../../shared/lingua/tagger"
import type { Optional } from "../../shared/optional"

export type CharacterRow = { slug: string; canonical: string }

export type TokenRow = {
  idx: number
  form: string
  lemma: string
  pos: string
  features: string
  provenance: string
  charStart: number
  charEnd: number
}

export type ChunkRow = {
  idx: number
  kind: string
  headIdx: number
  tokenStart: number
  tokenEnd: number
}

export type RelationRow = {
  headTokenIdx: number
  depTokenIdx: number
  relation: string
  provenance: string
  polarity: string
}

export type SentenceRow = {
  paragraphIdx: number
  idx: number
  charStart: number
  charEnd: number
  chapterIdx: Optional<number>
  chapterTitle: Optional<string>
  line: number
  col: number
  attributionKind: string
  attributionSlug: Optional<string>
  sentenceType: string
  tokens: readonly TokenRow[]
  chunks: readonly ChunkRow[]
  relations: readonly RelationRow[]
}

export type SpanRow = {
  kind: string
  charStart: number
  charEnd: number
  slug: Optional<string>
  unresolvedName: Optional<string>
}

// A cross-sentence discourse link, still in analysis coordinates: the store
// resolves (paragraphIdx, sentence idx) pairs to sentence row ids while it
// writes the sentences of the same refresh. From- and to-paragraph differ for
// the driver's cross-paragraph links.
export type DiscourseLinkRow = {
  fromParagraphIdx: number
  fromSentenceIdx: number
  fromTokenIdx: number
  toParagraphIdx: number
  toSentenceIdx: number
  toTokenIdx: number
  kind: string
  provenance: string
}

// Timeline rows, in the same analysis coordinates the discourse links use.
export type TimelineEventRow = {
  paragraphIdx: number
  sentenceIdx: number
  tokenIdx: number
  lane: string
  sense: string
  effect: string
}

export type TimelineEdgeRow = {
  fromParagraphIdx: number
  fromSentenceIdx: number
  fromTokenIdx: number
  toParagraphIdx: number
  toSentenceIdx: number
  toTokenIdx: number
  kind: string
  provenance: string
}

export type EntityRow = {
  name: string
  kind: string
  mentions: number
}

export type AliasRow = {
  slug: string
  description: string
}

export type TurnGuessRow = {
  paragraphIdx: number
  slug: string
}

export type AnalysisRows = {
  characters: readonly CharacterRow[]
  sentences: readonly SentenceRow[]
  spans: readonly SpanRow[]
  discourseLinks: readonly DiscourseLinkRow[]
  timelineEvents: readonly TimelineEventRow[]
  timelineEdges: readonly TimelineEdgeRow[]
  entities: readonly EntityRow[]
  aliases: readonly AliasRow[]
  turnGuesses: readonly TurnGuessRow[]
}

export function analysisToRows(analysis: BookAnalysis): AnalysisRows {
  const characters = analysis.cast.characters.map((c) => ({ slug: c.slug, canonical: c.name }))

  const sentences: SentenceRow[] = []
  const discourseLinks: DiscourseLinkRow[] = []

  for (const slot of analysis.paragraphs) {
    slot.analysis.sentences.forEach((sentence, idx) => {
      sentences.push(sentenceRow(sentence, slot.locations[idx]!, slot.index, idx))
    })

    for (const link of slot.analysis.discourse) {
      discourseLinks.push({
        fromParagraphIdx: slot.index,
        fromSentenceIdx: link.fromSentence,
        fromTokenIdx: link.fromToken,
        toParagraphIdx: slot.index,
        toSentenceIdx: link.toSentence,
        toTokenIdx: link.toToken,
        kind: link.kind,
        provenance: link.provenance,
      })
    }
  }

  for (const link of analysis.bookLinks) {
    discourseLinks.push({
      fromParagraphIdx: link.fromParagraph,
      fromSentenceIdx: link.fromSentence,
      fromTokenIdx: link.fromToken,
      toParagraphIdx: link.toParagraph,
      toSentenceIdx: link.toSentence,
      toTokenIdx: link.toToken,
      kind: link.kind,
      provenance: link.provenance,
    })
  }

  const timelineEvents: TimelineEventRow[] = []
  const timelineEdges: TimelineEdgeRow[] = []

  for (const slot of analysis.paragraphs) {
    for (const event of slot.analysis.timeline.events) {
      timelineEvents.push({
        paragraphIdx: slot.index,
        sentenceIdx: event.sentence,
        tokenIdx: event.token,
        lane: event.lane,
        sense: event.sense,
        effect: event.effect,
      })
    }

    for (const e of slot.analysis.timeline.edges) {
      timelineEdges.push({
        fromParagraphIdx: slot.index,
        fromSentenceIdx: e.fromSentence,
        fromTokenIdx: e.fromToken,
        toParagraphIdx: slot.index,
        toSentenceIdx: e.toSentence,
        toTokenIdx: e.toToken,
        kind: e.kind,
        provenance: e.provenance,
      })
    }
  }

  for (const e of analysis.timelineEdges) {
    timelineEdges.push({
      fromParagraphIdx: e.fromParagraph,
      fromSentenceIdx: e.fromSentence,
      fromTokenIdx: e.fromToken,
      toParagraphIdx: e.toParagraph,
      toSentenceIdx: e.toSentence,
      toTokenIdx: e.toToken,
      kind: e.kind,
      provenance: e.provenance,
    })
  }

  const entities = analysis.entities.map((e) => ({ name: e.name, kind: e.kind, mentions: e.mentions }))
  const aliases = analysis.aliases.map((a) => ({ slug: a.slug, description: a.description }))
  const turnGuesses = analysis.turnGuesses.map((t) => ({ paragraphIdx: t.paragraph, slug: t.slug }))

  const spans = analysis.spans.map(spanRow)

  return { characters, sentences, spans, discourseLinks, timelineEvents, timelineEdges, entities, aliases, turnGuesses }
}

function sentenceRow(sentence: Sentence, location: SentenceLocation, paragraphIdx: number, idx: number): SentenceRow {
  const parts = attributionParts(sentence.attribution)
  const chapter = chapterParts(location.chapter)

  return {
    paragraphIdx,
    idx,
    charStart: sentence.source.from,
    charEnd: sentence.source.to,
    chapterIdx: chapter.idx,
    chapterTitle: chapter.title,
    line: location.line,
    col: location.col,
    attributionKind: parts.kind,
    attributionSlug: parts.slug,
    sentenceType: sentence.sentenceType,
    tokens: sentence.tokens.map(tokenRow),
    chunks: sentence.chunks.map((chunk, ci) => ({
      idx: ci,
      kind: chunk.kind,
      headIdx: chunk.head,
      tokenStart: chunk.from,
      tokenEnd: chunk.to,
    })),
    relations: sentence.relations.map((relation) => ({
      headTokenIdx: relation.head,
      depTokenIdx: relation.dependent,
      relation: relation.kind,
      provenance: relation.provenance,
      polarity: relation.polarity,
    })),
  }
}

function tokenRow(token: AnalyzedToken, idx: number): TokenRow {
  switch (token.role) {
    case "content":
      return {
        idx,
        form: token.tagged.token.text,
        lemma: token.tagged.lemma,
        pos: token.tagged.pos,
        features: token.tagged.feat,
        provenance: token.tagged.provenance,
        charStart: token.tagged.token.source.from,
        charEnd: token.tagged.token.source.to,
      }
    case "punctuation":
      return {
        idx,
        form: token.token.text,
        lemma: token.token.text,
        pos: "PUNCT",
        features: "",
        provenance: "punctuation",
        charStart: token.token.source.from,
        charEnd: token.token.source.to,
      }
  }
}

function spanRow(span: GlyphSpan): SpanRow {
  const binding = bindingParts(span.binding)

  return {
    kind: span.kind,
    charStart: span.from,
    charEnd: span.to,
    slug: binding.slug,
    unresolvedName: binding.name,
  }
}

type ChapterParts = { idx: Optional<number>; title: Optional<string> }

function chapterParts(chapter: Optional<ChapterPlace>): ChapterParts {
  switch (chapter.kind) {
    case "none":
      return { idx: { kind: "none" }, title: { kind: "none" } }
    case "some":
      return {
        idx: { kind: "some", value: chapter.value.index },
        title: { kind: "some", value: chapter.value.title },
      }
  }
}

type AttributionParts = { kind: string; slug: Optional<string> }

function attributionParts(attribution: Attribution): AttributionParts {
  switch (attribution.kind) {
    case "narration":
      return { kind: "narration", slug: { kind: "none" } }
    case "speech":
      return { kind: "speech", slug: speakerSlug(attribution.speaker) }
    case "written":
      return { kind: "written", slug: speakerSlug(attribution.writer) }
  }
}

function speakerSlug(speaker: Speaker): Optional<string> {
  switch (speaker.kind) {
    case "slug":
      return { kind: "some", value: speaker.slug }
    case "unresolved":
      return { kind: "none" }
    case "unknown":
      return { kind: "none" }
  }
}

type BindingParts = { slug: Optional<string>; name: Optional<string> }

function bindingParts(binding: Binding): BindingParts {
  switch (binding.kind) {
    case "resolved":
      return { slug: { kind: "some", value: binding.slug }, name: { kind: "none" } }
    case "unresolved":
      return { slug: { kind: "none" }, name: { kind: "some", value: binding.name } }
    case "unknown":
      return { slug: { kind: "none" }, name: { kind: "none" } }
  }
}
