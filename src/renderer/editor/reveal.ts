// The one rule the whole live-preview obeys: a span of raw markdown is "revealed"
// (shown as source, marks and all) exactly when the cursor or a selection touches
// it. Touching counts — a cursor resting on either boundary reveals — so callers
// extend spans to full-line bounds wherever a line-level reveal is wanted.

export type Span = { from: number; to: number }

export function revealed(selectionRanges: readonly Span[], span: Span): boolean {
  return selectionRanges.some((range) => overlaps(range, span))
}

function overlaps(range: Span, span: Span): boolean {
  return range.from <= span.to && span.from <= range.to
}
