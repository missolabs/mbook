// The backend emitter: lingua.db is the compilation's object file, and this
// is the only module that speaks SQL to produce it. It
// owns lingua.db in userData — schema v3 (user_version = 3; v2 added sentence
// location: chapter_idx, chapter_title, line, col; v3 added discourse_links,
// the cross-sentence layer sentence-local relations cannot carry) — and exposes a thin
// interface (storedHash / refresh / close) so the analyzer never touches a
// statement. A whole-book refresh is one transaction: the book row is deleted
// (cascading every child away) and re-inserted with its fresh analysis, so the
// stored book is always internally consistent, never half-updated. Because the
// store is a derived cache refreshed whole-book at a time, the migration for a
// version mismatch is recreate-from-scratch: drop everything and let the next
// refresh repopulate it.
//
// The interface is deliberately narrow: were the native driver ever intractable,
// a WASM driver (sql.js) could implement openLinguaStore behind the same shape
// with no change above this file.

import Database from "better-sqlite3"

import type { Optional } from "../../shared/optional"
import { err, ok } from "../../shared/result"
import type { Result } from "../../shared/result"
import type {
  AnalysisRows,
  ChunkRow,
  DiscourseLinkRow,
  RelationRow,
  SentenceRow,
  TokenRow,
} from "./lower"

export type BookRecord = {
  path: string
  language: string
  contentHash: string
  analyzedAt: string
}

export type StoreError = { kind: "open-failed"; message: string }

export type LinguaStore = {
  storedHash: (path: string) => Optional<string>
  refresh: (record: BookRecord, rows: AnalysisRows) => void
  close: () => void
}

const SCHEMA = `
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  language TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);
CREATE TABLE characters (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  canonical TEXT NOT NULL
);
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  paragraph_idx INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  chapter_idx INTEGER,
  chapter_title TEXT,
  line INTEGER NOT NULL,
  col INTEGER NOT NULL,
  attribution_kind TEXT NOT NULL,
  attribution_slug TEXT,
  sentence_type TEXT NOT NULL DEFAULT 'declarative'
);
CREATE TABLE tokens (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  form TEXT NOT NULL,
  lemma TEXT NOT NULL,
  pos TEXT NOT NULL,
  features TEXT NOT NULL,
  provenance TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL
);
CREATE TABLE chunks (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  head_idx INTEGER NOT NULL,
  token_start INTEGER NOT NULL,
  token_end INTEGER NOT NULL
);
CREATE TABLE relations (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  head_token_idx INTEGER NOT NULL,
  dep_token_idx INTEGER NOT NULL,
  relation TEXT NOT NULL,
  provenance TEXT NOT NULL,
  polarity TEXT NOT NULL DEFAULT 'affirmative'
);
CREATE TABLE spans (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  slug TEXT,
  unresolved_name TEXT
);
CREATE TABLE discourse_links (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  from_sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  from_token_idx INTEGER NOT NULL,
  to_sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  to_token_idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  provenance TEXT NOT NULL
);
CREATE TABLE timeline_events (
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  token_idx INTEGER NOT NULL,
  lane TEXT NOT NULL,
  sense TEXT NOT NULL,
  effect TEXT NOT NULL
);
CREATE TABLE timeline_edges (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  from_sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  from_token_idx INTEGER NOT NULL,
  to_sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  to_token_idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  provenance TEXT NOT NULL
);
CREATE TABLE entities (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  mentions INTEGER NOT NULL
);
CREATE TABLE aliases (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE turn_guesses (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  paragraph_idx INTEGER NOT NULL,
  slug TEXT NOT NULL
);
`

type Db = InstanceType<typeof Database>

export function openLinguaStore(path: string): Result<LinguaStore, StoreError> {
  try {
    const db = new Database(path)

    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")

    migrate(db)

    return ok(store(db))
  } catch (caught) {
    return err({ kind: "open-failed", message: messageOf(caught) })
  }
}

const VERSION = 6

function migrate(db: Db): void {
  const version = currentVersion(db)

  switch (version === VERSION) {
    case true:
      return
    case false:
      break
  }

  db.exec(`
DROP TABLE IF EXISTS turn_guesses;
DROP TABLE IF EXISTS aliases;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS timeline_edges;
DROP TABLE IF EXISTS timeline_events;
DROP TABLE IF EXISTS discourse_links;
DROP TABLE IF EXISTS spans;
DROP TABLE IF EXISTS relations;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS tokens;
DROP TABLE IF EXISTS sentences;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS books;
`)

  db.exec(SCHEMA)
  db.pragma(`user_version = ${VERSION}`)
}

function currentVersion(db: Db): number {
  const rows = db.pragma("user_version") as { user_version: number }[]

  return rows[0]!.user_version
}

function store(db: Db): LinguaStore {
  const selectHash = db.prepare("SELECT content_hash AS hash FROM books WHERE path = ?")
  const deleteBook = db.prepare("DELETE FROM books WHERE path = ?")
  const insertBook = db.prepare(
    "INSERT INTO books (path, language, content_hash, analyzed_at) VALUES (?, ?, ?, ?)",
  )
  const insertCharacter = db.prepare(
    "INSERT INTO characters (book_id, slug, canonical) VALUES (?, ?, ?)",
  )
  const insertSentence = db.prepare(
    "INSERT INTO sentences (book_id, paragraph_idx, idx, char_start, char_end, chapter_idx, chapter_title, line, col, attribution_kind, attribution_slug, sentence_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  const insertToken = db.prepare(
    "INSERT INTO tokens (sentence_id, idx, form, lemma, pos, features, provenance, char_start, char_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  const insertChunk = db.prepare(
    "INSERT INTO chunks (sentence_id, idx, kind, head_idx, token_start, token_end) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const insertRelation = db.prepare(
    "INSERT INTO relations (sentence_id, head_token_idx, dep_token_idx, relation, provenance, polarity) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const insertSpan = db.prepare(
    "INSERT INTO spans (book_id, kind, char_start, char_end, slug, unresolved_name) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const insertDiscourseLink = db.prepare(
    "INSERT INTO discourse_links (book_id, from_sentence_id, from_token_idx, to_sentence_id, to_token_idx, kind, provenance) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  const insertTimelineEvent = db.prepare(
    "INSERT INTO timeline_events (sentence_id, token_idx, lane, sense, effect) VALUES (?, ?, ?, ?, ?)",
  )
  const insertTimelineEdge = db.prepare(
    "INSERT INTO timeline_edges (book_id, from_sentence_id, from_token_idx, to_sentence_id, to_token_idx, kind, provenance) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  const insertEntity = db.prepare(
    "INSERT INTO entities (book_id, name, kind, mentions) VALUES (?, ?, ?, ?)",
  )
  const insertAlias = db.prepare(
    "INSERT INTO aliases (book_id, slug, description) VALUES (?, ?, ?)",
  )
  const insertTurnGuess = db.prepare(
    "INSERT INTO turn_guesses (book_id, paragraph_idx, slug) VALUES (?, ?, ?)",
  )

  const writeAll = db.transaction((record: BookRecord, rows: AnalysisRows) => {
    deleteBook.run(record.path)

    const bookId = Number(
      insertBook.run(record.path, record.language, record.contentHash, record.analyzedAt).lastInsertRowid,
    )

    for (const character of rows.characters) {
      insertCharacter.run(bookId, character.slug, character.canonical)
    }

    const sentenceIds = new Map<string, number>()

    for (const sentence of rows.sentences) {
      sentenceIds.set(sentenceKey(sentence.paragraphIdx, sentence.idx), writeSentence(sentence, bookId))
    }

    for (const span of rows.spans) {
      insertSpan.run(bookId, span.kind, span.charStart, span.charEnd, orNull(span.slug), orNull(span.unresolvedName))
    }

    for (const link of rows.discourseLinks) {
      writeDiscourseLink(link, bookId, sentenceIds)
    }

    for (const event of rows.timelineEvents) {
      insertTimelineEvent.run(
        sentenceIdOf(sentenceIds, event.paragraphIdx, event.sentenceIdx),
        event.tokenIdx,
        event.lane,
        event.sense,
        event.effect,
      )
    }

    for (const e of rows.timelineEdges) {
      insertTimelineEdge.run(
        bookId,
        sentenceIdOf(sentenceIds, e.fromParagraphIdx, e.fromSentenceIdx),
        e.fromTokenIdx,
        sentenceIdOf(sentenceIds, e.toParagraphIdx, e.toSentenceIdx),
        e.toTokenIdx,
        e.kind,
        e.provenance,
      )
    }

    for (const entity of rows.entities) {
      insertEntity.run(bookId, entity.name, entity.kind, entity.mentions)
    }

    for (const alias of rows.aliases) {
      insertAlias.run(bookId, alias.slug, alias.description)
    }

    for (const guess of rows.turnGuesses) {
      insertTurnGuess.run(bookId, guess.paragraphIdx, guess.slug)
    }
  })

  function writeDiscourseLink(link: DiscourseLinkRow, bookId: number, ids: ReadonlyMap<string, number>): void {
    insertDiscourseLink.run(
      bookId,
      sentenceIdOf(ids, link.fromParagraphIdx, link.fromSentenceIdx),
      link.fromTokenIdx,
      sentenceIdOf(ids, link.toParagraphIdx, link.toSentenceIdx),
      link.toTokenIdx,
      link.kind,
      link.provenance,
    )
  }

  function writeSentence(sentence: SentenceRow, bookId: number): number {
    const sentenceId = Number(
      insertSentence.run(
        bookId,
        sentence.paragraphIdx,
        sentence.idx,
        sentence.charStart,
        sentence.charEnd,
        orNull(sentence.chapterIdx),
        orNull(sentence.chapterTitle),
        sentence.line,
        sentence.col,
        sentence.attributionKind,
        orNull(sentence.attributionSlug),
        sentence.sentenceType,
      ).lastInsertRowid,
    )

    for (const token of sentence.tokens) {
      writeToken(token, sentenceId)
    }

    for (const chunk of sentence.chunks) {
      writeChunk(chunk, sentenceId)
    }

    for (const relation of sentence.relations) {
      writeRelation(relation, sentenceId)
    }

    return sentenceId
  }

  function writeToken(token: TokenRow, sentenceId: number): void {
    insertToken.run(
      sentenceId,
      token.idx,
      token.form,
      token.lemma,
      token.pos,
      token.features,
      token.provenance,
      token.charStart,
      token.charEnd,
    )
  }

  function writeChunk(chunk: ChunkRow, sentenceId: number): void {
    insertChunk.run(sentenceId, chunk.idx, chunk.kind, chunk.headIdx, chunk.tokenStart, chunk.tokenEnd)
  }

  function writeRelation(relation: RelationRow, sentenceId: number): void {
    insertRelation.run(
      sentenceId,
      relation.headTokenIdx,
      relation.depTokenIdx,
      relation.relation,
      relation.provenance,
      relation.polarity,
    )
  }

  return {
    storedHash: (path) => readHash(selectHash, path),
    refresh: (record, rows) => writeAll(record, rows),
    close: () => db.close(),
  }
}

function sentenceKey(paragraphIdx: number, idx: number): string {
  return `${paragraphIdx}:${idx}`
}

// A link's endpoints come from the same analysis whose sentences were just
// written, so a miss is a provably broken invariant, not an expected outcome.
function sentenceIdOf(ids: ReadonlyMap<string, number>, paragraphIdx: number, idx: number): number {
  const id = ids.get(sentenceKey(paragraphIdx, idx))

  switch (id === undefined) {
    case true:
      throw new Error(`invariant: no sentence row for ${sentenceKey(paragraphIdx, idx)}`)
    case false:
      return id!
  }
}

function readHash(statement: Database.Statement, path: string): Optional<string> {
  const row = statement.get(path) as { hash: string } | undefined

  switch (row === undefined) {
    case true:
      return { kind: "none" }
    case false:
      return { kind: "some", value: row!.hash }
  }
}

function orNull<T>(value: Optional<T>): T | null {
  switch (value.kind) {
    case "some":
      return value.value
    case "none":
      return null
  }
}

function messageOf(caught: unknown): string {
  switch (caught instanceof Error) {
    case true:
      return (caught as Error).message
    case false:
      return String(caught)
  }
}
