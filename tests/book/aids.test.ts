import { describe, it, expect } from "bun:test"

import { decideTypingAid } from "../../src/shared/book/aids"

describe("decideTypingAid — em dash", () => {
  it("folds -- into an em dash on the next non-hyphen keystroke", () => {
    expect(decideTypingAid({ before: "--", typed: "a" })).toEqual({
      kind: "replace",
      deleteBefore: 2,
      insert: "—a",
    })
  })

  it("carries the typed character mid-sentence", () => {
    expect(decideTypingAid({ before: "Ele disse--", typed: "q" })).toEqual({
      kind: "replace",
      deleteBefore: 2,
      insert: "—q",
    })
  })

  it("passes a third hyphen so a --- separator stays typeable", () => {
    expect(decideTypingAid({ before: "--", typed: "-" })).toEqual({ kind: "pass" })
  })
})

describe("decideTypingAid — pt-BR quotes", () => {
  it("opens a quote at the start of a line", () => {
    expect(decideTypingAid({ before: "", typed: '"' })).toEqual({
      kind: "replace",
      deleteBefore: 0,
      insert: "“",
    })
  })

  it("opens a quote after whitespace", () => {
    expect(decideTypingAid({ before: "Ela disse ", typed: '"' })).toEqual({
      kind: "replace",
      deleteBefore: 0,
      insert: "“",
    })
  })

  it("opens a quote right after a travessão", () => {
    expect(decideTypingAid({ before: "—", typed: '"' })).toEqual({
      kind: "replace",
      deleteBefore: 0,
      insert: "“",
    })
  })

  it("closes a quote after a letter", () => {
    expect(decideTypingAid({ before: "Olá", typed: '"' })).toEqual({
      kind: "replace",
      deleteBefore: 0,
      insert: "”",
    })
  })
})

describe("decideTypingAid — otherwise", () => {
  it("passes an ordinary keystroke through untouched", () => {
    expect(decideTypingAid({ before: "abc", typed: "d" })).toEqual({ kind: "pass" })
  })
})
