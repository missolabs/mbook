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

import { buildCast, buildDeclarations } from "../book/cast"
import type { Cast, Declarations } from "../book/cast"
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
import type { DiscourseLink, DiscourseLinkKind, DiscourseProvenance } from "./dataflow"
import type { TimelineEdgeKind, TimelineEvent, TimelineProvenance } from "./timeline"
import { readLanguage } from "./language"
import type { Language } from "./language"
import type { Lexicon } from "./lexicon"
import type { Entry, Pos } from "./model"

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
export type EntityKind = "person" | "animal" | "organization" | "place" | "object" | "unknown"

export type NamedEntity = {
  name: string
  kind: EntityKind
  mentions: number
}

// Each cast member's grammatical gender, decided by ORDERED evidence:
//   1. authored — a display group bound to the member whose text leads with a
//      gendered closed-class word (`{Ela}[Daniela]`, `{a moça}[Daniela]`) is
//      the author speaking; majority of such votes wins, a tie stays unknown;
//   2. dictionary — the name's own PROPN entry (Daniela fs, Rei ms), first
//      word for compound names, with a common-noun reading as fallback
//      (`Narrador` ms);
//   3. unknown — a name the book never gendered and the dictionary never met
//      (Hellmanns) ranks neutrally everywhere downstream.
export type CastGender = "f" | "m" | "unknown"

export type CastMember = { slug: string; name: string; gender: CastGender }

export type BookAnalysis = {
  language: Language
  cast: Cast
  castMembers: readonly CastMember[]
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
  diagnostics: readonly Diagnostic[]
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

// The compiler's honest uncertainty, addressed to the author: every
// load-bearing guess and every unresolved reference, with the glyph or
// declaration that would settle it. This is the lint surface — the engine
// asks, the author pins, ambiguity burns down.
export type DiagnosticKind =
  | "contested-token"
  | "unresolved-name"
  | "unresolved-pronoun"
  // An authored alias whose brackets are empty (`{Ela}[]`): the author
  // already acted — the remaining question is only WHO goes in the brackets.
  | "empty-binding"
  | "unstitched-chapter"

export type Diagnostic = {
  kind: DiagnosticKind
  paragraph: number
  sentence: number
  token: number
  detail: string
  // Doc-absolute character range — what an editor underlines.
  charFrom: number
  charTo: number
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

  // Typeset verse — a paragraph whose EVERY line is centered (`-> Tic Tac <-`)
  // — is display, not narration: the poem never reaches the pipeline, so its
  // lines put no events on the timeline and no words in the graph.
  const paragraphs = paragraphBlocks(doc.blocks)
    .filter((block) => verseBlock(lines, block) === false)
    .map((block, index) => analyzeSlot(block, index, lines, spans, starts, chapters, lexicon.value, language))

  const aliases = collectAliases(paragraphs, cast)
  const declarations = buildDeclarations(doc)
  const crossLinks = crossParagraphLinks(paragraphs, lexicon.value)
  const bookLinks = [...crossLinks, ...voiceLinks(paragraphs, lexicon.value, crossLinks)]

  return ok({
    language,
    cast,
    castMembers: genderCast(cast, spans, lexicon.value),
    paragraphs,
    spans,
    unresolved: unresolvedNames(spans),
    bookLinks,
    entities: nameEntities(paragraphs, cast, lexicon.value, declarations),
    timelineEdges: [...stitchTimelines(paragraphs), ...causalEdges(paragraphs)],
    aliases,
    aliasMentions: resolveAliasMentions(paragraphs, aliases, lexicon.value),
    turnGuesses: guessTurns(paragraphs, cast),
    diagnostics: collectDiagnostics(paragraphs, lexicon.value, bookLinks, starts),
  })
}

// ─── diagnostics ─────────────────────────────────────────────────────────────
function spread(range: { from: number; to: number }): { charFrom: number; charTo: number } {
  return { charFrom: range.from, charTo: range.to }
}

function collectDiagnostics(
  paragraphs: readonly ParagraphSlot[],
  lexicon: Lexicon,
  bookLinks: readonly BookLink[],
  starts: readonly number[],
): readonly Diagnostic[] {
  const out: Diagnostic[] = []

  // Doc-absolute range of a token (or of the whole sentence for token -1):
  // the paragraph's first-line offset plus the token's paragraph-relative span.
  const rangeOf = (slot: ParagraphSlot, si: number, ti: number): { from: number; to: number } => {
    const base = starts[slot.fromLine] ?? 0
    const sentence = slot.analysis.sentences[si]

    switch (sentence === undefined) {
      case true:
        return { from: base, to: base }
      case false:
        break
    }

    switch (ti < 0) {
      case true:
        return { from: base + sentence!.source.from, to: base + sentence!.source.to }
      case false:
        break
    }

    const token = sentence!.tokens[ti]

    switch (token === undefined) {
      case true:
        return { from: base + sentence!.source.from, to: base + sentence!.source.to }
      case false:
        break
    }

    switch (token!.role) {
      case "content":
        return { from: base + token!.tagged.token.source.from, to: base + token!.tagged.token.source.to }
      case "punctuation":
        return { from: base + token!.token.source.from, to: base + token!.token.source.to }
    }
  }

  for (const slot of paragraphs) {
    // Tokens already covered by an authored mention glyph: the author has
    // acted there, so the pronoun lint stands down — an empty binding gets
    // its OWN diagnostic below instead of re-flagging the word.
    const covered = new Set<string>()

    for (const anchored of slot.analysis.spans) {
      const mention =
        anchored.span.kind === "subject-mention" && anchored.anchor.kind === "in-sentence"

      switch (mention) {
        case false:
          continue
        case true:
          break
      }

      const anchor = anchored.anchor as { sentence: number; tokens: readonly number[] }

      for (const t of anchor.tokens) {
        covered.add(`${anchor.sentence}:${t}`)
      }
    }

    slot.analysis.sentences.forEach((sentence, si) => {
      sentence.tokens.forEach((token, ti) => {
        switch (token.role) {
          case "punctuation":
            return
          case "content":
            break
        }

        // Short closed-class collisions (`a`, `o`) are contested in the
        // tagger's ledger but not actionable prose — the lint keeps to words
        // an author could actually rephrase.
        switch (token.tagged.provenance === "contested" && token.tagged.token.text.length >= 3) {
          case true:
            out.push({ kind: "contested-token", paragraph: slot.index, sentence: si, token: ti, detail: token.tagged.token.text, ...spread(rangeOf(slot, si, ti)) })
            break
          case false:
            break
        }

        const lower = token.tagged.token.text.toLowerCase()
        const anaphor = lexicon.syntax.anaphoricPronouns.some((a) => a.form === lower)
        const articleShaped = lexicon.syntax.definiteArticles.includes(lower)

        switch (anaphor && articleShaped === false) {
          case false:
            return
          case true:
            break
        }

        const linked =
          slot.analysis.discourse.some(
            (d) => d.kind === "anaphora" && d.fromSentence === si && d.fromToken === ti,
          ) ||
          bookLinks.some(
            (l) => l.kind === "anaphora" && l.fromParagraph === slot.index && l.fromSentence === si && l.fromToken === ti,
          )

        switch (linked || covered.has(`${si}:${ti}`)) {
          case true:
            return
          case false:
            out.push({ kind: "unresolved-pronoun", paragraph: slot.index, sentence: si, token: ti, detail: token.tagged.token.text, ...spread(rangeOf(slot, si, ti)) })
            return
        }
      })
    })

    for (const anchored of slot.analysis.spans) {
      switch (anchored.anchor.kind === "in-sentence") {
        case false:
          continue
        case true:
          break
      }

      // A group flags each of ITS unresolved members on its own — the
      // resolved ones need nothing.
      switch (anchored.span.binding.kind === "group") {
        case true: {
          const sentence = (anchored.anchor as { sentence: number }).sentence
          const token = (anchored.anchor as { tokens: readonly number[] }).tokens[0] ?? -1

          for (const member of (anchored.span.binding as { unresolved: readonly string[] }).unresolved) {
            out.push({
              kind: "unresolved-name",
              paragraph: slot.index,
              sentence,
              token,
              detail: member,
              ...spread(rangeOf(slot, sentence, token)),
            })
          }
          continue
        }
        case false:
          break
      }

      switch (anchored.span.binding.kind === "unresolved") {
        case false:
          continue
        case true:
          break
      }

      const name = (anchored.span.binding as { name: string }).name
      const sentence = (anchored.anchor as { sentence: number }).sentence
      const token = (anchored.anchor as { tokens: readonly number[] }).tokens[0] ?? -1
      const base = starts[slot.fromLine] ?? 0

      switch (name.trim().length === 0) {
        case true:
          // `{Ela}[]` — the glyph exists, the brackets are empty. The range
          // is the WHOLE glyph so the fix can land the caret inside it.
          out.push({
            kind: "empty-binding",
            paragraph: slot.index,
            sentence,
            token,
            detail: anchored.span.text,
            charFrom: base + anchored.span.from,
            charTo: base + anchored.span.to,
          })
          continue
        case false:
          out.push({
            kind: "unresolved-name",
            paragraph: slot.index,
            sentence,
            token,
            detail: name,
            ...spread(rangeOf(slot, sentence, token)),
          })
          continue
      }
    }
  }

  for (let i = 1; i < paragraphs.length; i++) {
    const prev = paragraphs[i - 1]!
    const curr = paragraphs[i]!

    const blocked =
      sameChapter(prev, curr) === false &&
      curr.analysis.timeline.pins.length === 0 &&
      lastPerfective(prev.analysis.timeline.events).kind === "some" &&
      firstPerfective(curr.analysis.timeline.events).kind === "some"

    switch (blocked) {
      case true:
        out.push({ kind: "unstitched-chapter", paragraph: curr.index, sentence: 0, token: -1, detail: "chapter break — a ~[...] pin would order it", ...spread(rangeOf(curr, 0, -1)) })
        continue
      case false:
        continue
    }
  }

  return out
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
function verseBlock(lines: readonly string[], block: { fromLine: number; toLine: number }): boolean {
  for (let n = block.fromLine; n <= block.toLine; n++) {
    const line = (lines[n] ?? "").trim()

    switch (line.startsWith("->") && line.endsWith("<-")) {
      case true:
        continue
      case false:
        return false
    }
  }

  return true
}

// ─── the first-person voice ──────────────────────────────────────────────────
// The narrating `eu` is BOOK-GLOBAL: when every first-person display glyph in
// the book ({eu}[Narrador], {Eu}[X]) binds the same character, that character
// IS the voice, and every unclaimed first-person finite verb in narration
// links to it — chapters written before the first glyph included (the anchor
// is then cataphoric, pointing at the voice's first mention). Two different
// voices declared anywhere and the pass stands down entirely: a book with two
// narrating "eu"s keeps its per-paragraph proximity rule alone.
type VoiceMention = { slug: string; paragraph: number; sentence: number; token: number }

function voiceLinks(
  paragraphs: readonly ParagraphSlot[],
  lexicon: Lexicon,
  claimed: readonly BookLink[],
): readonly BookLink[] {
  const mentions = firstPersonMentions(paragraphs, lexicon)
  const slugs = new Set(mentions.map((m) => m.slug))

  switch (mentions.length === 0 || slugs.size !== 1) {
    case true:
      return []
    case false:
      break
  }

  const links: BookLink[] = []

  for (const slot of paragraphs) {
    slot.analysis.sentences.forEach((sentence, si) => {
      switch (sentence.attribution.kind) {
        case "narration":
          break
        case "speech":
        case "written":
          return
      }

      for (const chunk of sentence.chunks) {
        switch (chunk.kind) {
          case "VP":
            break
          case "NP":
          case "PP":
            continue
        }

        switch (unclaimedFirstPerson(sentence, chunk.head, lexicon)) {
          case false:
            continue
          case true:
            break
        }

        switch (
          hasElidedSubject(slot.analysis.discourse, si, chunk.head) ||
          hasBookElidedSubject(claimed, slot.index, si, chunk.head)
        ) {
          case true:
            continue
          case false:
            break
        }

        const anchor = voiceAnchorFor(mentions, slot.index, si)

        links.push({
          kind: "elided-subject",
          fromParagraph: slot.index,
          fromSentence: si,
          fromToken: chunk.head,
          toParagraph: anchor.paragraph,
          toSentence: anchor.sentence,
          toToken: anchor.token,
          provenance: "discourse",
        })
      }

      // An EXPLICIT first-person subject (`Nessa época eu comecei…`) claims
      // the voice too — an anaphora link from the pronoun itself. Tokens that
      // ARE voice mentions ({eu}[Narrador] displays) need no link.
      sentence.tokens.forEach((token, ti) => {
        switch (token.role) {
          case "punctuation":
            return
          case "content":
            break
        }

        switch (firstPersonWord(token.tagged.token.text, lexicon)) {
          case false:
            return
          case true:
            break
        }

        switch (sentence.relations.some((r) => r.kind === "subject-of" && r.dependent === ti)) {
          case false:
            return
          case true:
            break
        }

        const isMention = mentions.some(
          (m) => m.paragraph === slot.index && m.sentence === si && m.token === ti,
        )

        switch (isMention || hasAnaphora(slot.analysis.discourse, si, ti)) {
          case true:
            return
          case false:
            break
        }

        const anchor = voiceAnchorFor(mentions, slot.index, si)

        links.push({
          kind: "anaphora",
          fromParagraph: slot.index,
          fromSentence: si,
          fromToken: ti,
          toParagraph: anchor.paragraph,
          toSentence: anchor.sentence,
          toToken: anchor.token,
          provenance: "discourse",
        })
      })
    })
  }

  return links
}

function firstPersonMentions(paragraphs: readonly ParagraphSlot[], lexicon: Lexicon): readonly VoiceMention[] {
  const out: VoiceMention[] = []

  for (const slot of paragraphs) {
    for (const anchored of slot.analysis.spans) {
      const span = anchored.span

      const qualifies =
        span.kind === "subject-mention" && span.binding.kind === "resolved" && anchored.anchor.kind === "in-sentence"

      switch (qualifies) {
        case false:
          continue
        case true:
          break
      }

      const lead = span.text.trim().split(/\s+/)[0] ?? ""

      switch (firstPersonWord(lead, lexicon)) {
        case false:
          continue
        case true:
          break
      }

      const anchor = anchored.anchor as { sentence: number; tokens: readonly number[] }

      out.push({
        slug: (span.binding as { slug: string }).slug,
        paragraph: slot.index,
        sentence: anchor.sentence,
        token: anchor.tokens[0] ?? 0,
      })
    }
  }

  return out
}

// `eu`/`me` by their PRON first-person feat — or the bare English `I`, whose
// dictionary entry carries no feats at all.
function firstPersonWord(word: string, lexicon: Lexicon): boolean {
  const lower = word.toLowerCase()

  switch (lower === "i") {
    case true:
      return true
    case false:
      break
  }

  for (const entry of lexicon.lookup(lower, { kind: "all" })) {
    switch (entry.pos === "PRON" && entry.feat.includes("1")) {
      case true:
        return true
      case false:
        continue
    }
  }

  return false
}

// A finite first-person verb the binder pinned no subject on.
function unclaimedFirstPerson(sentence: Sentence, head: number, lexicon: Lexicon): boolean {
  const token = sentence.tokens[head]

  switch (token === undefined || token!.role === "punctuation") {
    case true:
      return false
    case false:
      break
  }

  const feat = (token! as { tagged: { feat: string } }).tagged.feat

  const firstPerson =
    lexicon.syntax.verbFeats.finitePrefixes.some((p) => feat.startsWith(p)) && feat.includes("1")

  switch (firstPerson) {
    case false:
      return false
    case true:
      break
  }

  return sentence.relations.some((r) => r.kind === "subject-of" && r.head === head) === false
}

function hasElidedSubject(links: readonly DiscourseLink[], si: number, ti: number): boolean {
  return links.some((l) => l.kind === "elided-subject" && l.fromSentence === si && l.fromToken === ti)
}

function hasAnaphora(links: readonly DiscourseLink[], si: number, ti: number): boolean {
  return links.some((l) => l.kind === "anaphora" && l.fromSentence === si && l.fromToken === ti)
}

function hasBookElidedSubject(links: readonly BookLink[], p: number, si: number, ti: number): boolean {
  return links.some(
    (l) => l.kind === "elided-subject" && l.fromParagraph === p && l.fromSentence === si && l.fromToken === ti,
  )
}

// The voice's nearest preceding mention — or its first mention, for verbs
// narrated before the voice ever wears a glyph.
function voiceAnchorFor(mentions: readonly VoiceMention[], paragraph: number, sentence: number): VoiceMention {
  let best: VoiceMention | null = null

  for (const mention of mentions) {
    const precedes =
      mention.paragraph < paragraph || (mention.paragraph === paragraph && mention.sentence <= sentence)

    switch (precedes) {
      case false:
        continue
      case true:
        best = mention
        continue
    }
  }

  return best ?? mentions[0]!
}

// ─── causal edges ────────────────────────────────────────────────────────────
// The discourse pass already reads consequence markers (`portanto`, `então`);
// each such link becomes a timeline edge: the predecessor sentence's LAST
// event causes the marker sentence's FIRST. The one edge that answers WHY.
function causalEdges(paragraphs: readonly ParagraphSlot[]): readonly BookTimelineEdge[] {
  const out: BookTimelineEdge[] = []

  for (const slot of paragraphs) {
    for (const link of slot.analysis.discourse) {
      switch (link.kind) {
        case "consequence":
          break
        default:
          continue
      }

      const cause = lastEventOf(slot, link.toSentence)
      const effect = firstEventOf(slot, link.fromSentence)

      switch (cause.kind === "some" && effect.kind === "some") {
        case false:
          continue
        case true:
          break
      }

      out.push({
        kind: "causes",
        fromParagraph: slot.index,
        fromSentence: link.toSentence,
        fromToken: (cause as { value: TimelineEvent }).value.token,
        toParagraph: slot.index,
        toSentence: link.fromSentence,
        toToken: (effect as { value: TimelineEvent }).value.token,
        provenance: "connective",
      })
    }
  }

  return out
}

function lastEventOf(slot: ParagraphSlot, sentence: number): Optional<TimelineEvent> {
  const events = slot.analysis.timeline.events.filter((e) => e.sentence === sentence)
  const last = events[events.length - 1]

  switch (last === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: last! }
  }
}

function firstEventOf(slot: ParagraphSlot, sentence: number): Optional<TimelineEvent> {
  const first = slot.analysis.timeline.events.find((e) => e.sentence === sentence)

  switch (first === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: first! }
  }
}

function stitchTimelines(paragraphs: readonly ParagraphSlot[]): readonly BookTimelineEdge[] {
  const out: BookTimelineEdge[] = []

  for (let i = 1; i < paragraphs.length; i++) {
    const prev = paragraphs[i - 1]!
    const curr = paragraphs[i]!

    // An authored `~[...]` pin OVERRIDES the chapter gate and the direction:
    // a retreat pin (`~[antes]`, `~[-...]`) says this scene precedes the
    // previous one; anything else orders forward. No pin keeps the honest
    // default — same-chapter forward stitching only.
    const pin = curr.analysis.timeline.pins[0]

    switch (pin === undefined && sameChapter(prev, curr) === false) {
      case true:
        continue
      case false:
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

    switch (pin !== undefined && pinRetreats(pin!)) {
      case true:
        out.push({
          kind: "before",
          fromParagraph: curr.index,
          fromSentence: b.sentence,
          fromToken: b.token,
          toParagraph: prev.index,
          toSentence: a.sentence,
          toToken: a.token,
          provenance: "pinned",
        })
        continue
      case false:
        break
    }

    out.push({
      kind: "before",
      fromParagraph: prev.index,
      fromSentence: a.sentence,
      fromToken: a.token,
      toParagraph: curr.index,
      toSentence: b.sentence,
      toToken: b.token,
      provenance: pin === undefined ? "narrative-advance" : "pinned",
    })
  }

  return out
}

function pinRetreats(pin: string): boolean {
  const value = pin.trim().toLowerCase()

  return value === "antes" || value === "before" || value === "earlier" || value.startsWith("-")
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

// ─── cast gender ─────────────────────────────────────────────────────────────
function genderCast(cast: Cast, spans: readonly GlyphSpan[], lexicon: Lexicon): readonly CastMember[] {
  return cast.characters.map((character) => ({
    slug: character.slug,
    name: character.name,
    gender: memberGender(character.slug, character.name, spans, lexicon),
  }))
}

function memberGender(slug: string, name: string, spans: readonly GlyphSpan[], lexicon: Lexicon): CastGender {
  const authored = authoredGender(slug, spans, lexicon)

  switch (authored) {
    case "f":
    case "m":
      return authored
    case "unknown":
      break
  }

  return dictionaryGender(name, lexicon)
}

// Display groups bound to this member vote with their leading word:
// `{Ela}[Daniela]` and `{a moça}[Daniela]` each say feminine. A name-shaped
// display (`@[Rei]` writes the name itself) votes nothing.
function authoredGender(slug: string, spans: readonly GlyphSpan[], lexicon: Lexicon): CastGender {
  let f = 0
  let m = 0

  for (const span of spans) {
    const binding = span.binding

    // A group display genders EVERY member it binds — `{elas}[Esposa, Filha]`
    // is the author saying feminine of both.
    switch (binding.kind) {
      case "resolved":
      case "group":
        break
      case "unresolved":
      case "unknown":
        continue
    }

    const bound = binding.kind === "resolved" ? [binding.slug] : binding.slugs

    switch (bound.includes(slug)) {
      case false:
        continue
      case true:
        break
    }

    const lead = span.text.trim().split(/\s+/)[0] ?? ""

    switch (closedClassGender(lead, lexicon)) {
      case "f":
        f += 1
        continue
      case "m":
        m += 1
        continue
      case "unknown":
        continue
    }
  }

  return majority(f, m)
}

function majority(f: number, m: number): CastGender {
  switch (f > m) {
    case true:
      return "f"
    case false:
      break
  }

  switch (m > f) {
    case true:
      return "m"
    case false:
      return "unknown"
  }
}

// Only a pronoun or article carries authored gender; the gender letter sits
// anywhere in the feat (article `a` fs, but pronoun `ela` N3fs — the case
// marker leads), so feats are scanned, not indexed. And only a UNANIMOUS
// gender counts: `eu` lists N1fs and N1ms both, so first person abstains.
function closedClassGender(word: string, lexicon: Lexicon): CastGender {
  let f = 0
  let m = 0

  for (const entry of lexicon.lookup(word.toLowerCase(), { kind: "all" })) {
    switch (entry.pos) {
      case "PRON":
      case "DET":
        break
      default:
        continue
    }

    for (const mark of entry.feat) {
      switch (mark) {
        case "f":
          f += 1
          continue
        case "m":
          m += 1
          continue
        default:
          continue
      }
    }
  }

  switch (f > 0 && m === 0) {
    case true:
      return "f"
    case false:
      break
  }

  switch (m > 0 && f === 0) {
    case true:
      return "m"
    case false:
      return "unknown"
  }
}

// The dictionary's own word on the name: a PROPN entry first, a common-noun
// reading second. Conflicting entries cancel — only a unanimous gender counts.
function dictionaryGender(name: string, lexicon: Lexicon): CastGender {
  const first = name.split(/\s+/)[0] ?? name
  const proper = genderAmong(lexicon.lookup(first, { kind: "all" }), "PROPN")

  switch (proper) {
    case "f":
    case "m":
      return proper
    case "unknown":
      break
  }

  return genderAmong(lexicon.lookup(first.toLowerCase(), { kind: "all" }), "NOUN")
}

function genderAmong(entries: readonly Entry[], pos: Pos): CastGender {
  let f = 0
  let m = 0

  for (const entry of entries) {
    switch (entry.pos === pos) {
      case false:
        continue
      case true:
        break
    }

    switch (entry.feat[0]) {
      case "f":
        f += 1
        continue
      case "m":
        m += 1
        continue
      default:
        continue
    }
  }

  switch (f > 0 && m === 0) {
    case true:
      return "f"
    case false:
      break
  }

  switch (m > 0 && f === 0) {
    case true:
      return "m"
    case false:
      return "unknown"
  }
}

// Every proper-noun NP outside the cast, aggregated by surface name; each
// mention contributes ORDERED evidence and the strongest kind ever seen
// decides. Mentions inside quote marks contribute no evidence at all — a
// quoted title names no one and no place.
type EntityEvidence = { mentions: number; person: number; typed: Map<EntityKind, number>; locative: number }

function nameEntities(
  paragraphs: readonly ParagraphSlot[],
  cast: Cast,
  lexicon: Lexicon,
  declarations: Declarations,
): readonly NamedEntity[] {
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
  const declaredPlaces = new Set(declarations.places)

  for (const [name, entry] of tally) {
    switch (declaredPlaces.has(name)) {
      case true:
        continue
      case false:
        out.push({ name, kind: entityKind(entry), mentions: entry.mentions })
        continue
    }
  }

  // Declarations outrank every evidence rule — an authored `place:` IS a
  // place, mentioned or not; an `object:` is tracked by its lemma across the
  // whole book.
  for (const place of declarations.places) {
    out.push({ name: place, kind: "place", mentions: tally.get(place)?.mentions ?? 0 })
  }

  for (const object of declarations.objects) {
    out.push({ name: object, kind: "object", mentions: lemmaMentions(paragraphs, object.toLowerCase()) })
  }

  return out
}

function lemmaMentions(paragraphs: readonly ParagraphSlot[], lemma: string): number {
  let count = 0

  for (const slot of paragraphs) {
    for (const sentence of slot.analysis.sentences) {
      for (const token of sentence.tokens) {
        switch (token.role) {
          case "punctuation":
            continue
          case "content":
            break
        }

        switch (token.tagged.pos === "NOUN" && token.tagged.lemma === lemma) {
          case true:
            count++
            continue
          case false:
            continue
        }
      }
    }
  }

  return count
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
    for (const name of unresolvedOf(span.binding)) {
      switch (seen.has(name)) {
        case true:
          continue
        case false:
          seen.add(name)
          out.push(name)
          continue
      }
    }
  }

  return out
}

function unresolvedOf(binding: Binding): readonly string[] {
  switch (binding.kind) {
    case "unresolved":
      return [binding.name]
    case "group":
      return binding.unresolved
    case "resolved":
      return []
    case "unknown":
      return []
  }
}
