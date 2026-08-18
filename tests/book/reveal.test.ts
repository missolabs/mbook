import { describe, it, expect } from "bun:test"

import { revealed } from "../../src/renderer/editor/reveal"
import type { Span } from "../../src/renderer/editor/reveal"

// The span under test is the same throughout: characters 2..8 of some line.
const SPAN: Span = { from: 2, to: 8 }

describe("revealed", () => {
  it("reveals when a cursor rests inside the span", () => {
    const cursor: Span = { from: 5, to: 5 }

    expect(revealed([cursor], SPAN)).toBe(true)
  })

  it("reveals when a cursor sits exactly on a boundary", () => {
    const atEnd: Span = { from: 8, to: 8 }

    expect(revealed([atEnd], SPAN)).toBe(true)
  })

  it("does not reveal when the cursor is one past the end", () => {
    const after: Span = { from: 9, to: 9 }

    expect(revealed([after], SPAN)).toBe(false)
  })

  it("reveals when a selection range straddles the span's edge", () => {
    const straddle: Span = { from: 6, to: 20 }

    expect(revealed([straddle], SPAN)).toBe(true)
  })
})
