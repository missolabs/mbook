import { markdown } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { keymap } from "@codemirror/view"
import { EditorView, drawSelection } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import { tags } from "@lezer/highlight"
import { frontmatterField } from "./frontmatter-field"
import { structurePlugin } from "./structure-plugin"
import { createTypingAids } from "./aids-extension"
import { pageJointsField } from "./page-breaks"
import { pageLayer } from "./page-layer"

// The book page, in mdesign's tokens: a true A5 sheet (148mm trim, border-box,
// so the soft edge marks sit exactly on the trim) centred in the host, on
// transparent material so the window's vibrancy shows through. The sheet runs as
// one continuous galley — height is unbounded, but an empty book still shows a
// full 210mm page. Inner padding is the typographic page margin (18mm sides,
// 20mm head). No gutters, no line numbers, no active-line tint — this is a
// manuscript, not a code buffer. The 2px gold caret is the only alive object
// (R1); selection is a tint of the surface, never a colour of its own (R3). The
// tall paddingBottom keeps the line being typed off the floor of the window.
// Zoom scales the sheet and its type by the same --mb-zoom factor, so line
// breaks never reflow — the page grows like a Google Docs zoom, not a resize.
// Everything inside the sheet is em-based or multiplied by the factor here;
// chrome (sidebar, minimap, statusbar) deliberately stays at 1:1.
const bookTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--m-ink)",
    fontSize: "calc(17.5px * var(--mb-zoom, 1))",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--mb-serif)",
    lineHeight: "1.7",
    paddingTop: "40px",
    paddingBottom: "45vh",
  },
  ".cm-content": {
    // flex:none overrides the base theme's flex-grow:2, which would stretch
    // the sheet to the scroller's full width no matter what width says.
    flex: "none",
    boxSizing: "border-box",
    width: "calc(148mm * var(--mb-zoom, 1))",
    maxWidth: "100%",
    minHeight: "calc(210mm * var(--mb-zoom, 1))",
    margin: "0 auto",
    caretColor: "transparent",
    // The A5 text-block margins (19 top / 16.5 sides, matching the pagination
    // model's derivation). No bottom padding: every sheet's 22mm foot — the
    // last one included — is carried by a page joint in the flow. The surface
    // and trim marks are painted per sheet by page-layer.ts, not here.
    padding:
      "calc(19mm * var(--mb-zoom, 1)) calc(16.5mm * var(--mb-zoom, 1)) 0",
    backgroundColor: "transparent",
  },
  // The base theme pads lines 6px left / 2px right — a caret allowance for
  // gutterless buffers. Inside the sheet's 18mm margins it only skews the
  // text column 2px off the page axis, so it goes.
  ".cm-line": {
    padding: "0",
  },
  "& .cm-cursorLayer .cm-cursor": {
    borderLeft: "2px solid var(--m-gold)",
    marginLeft: "-1px",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--m-tint-2) !important",
  },
})

// Marks stay visible but dim (--m-mist) so the raw markdown reads as prose with
// quiet machinery; Step 5's live preview hides them entirely. Emphasis and
// strong render their real weight/slant so the page already looks typeset.
const bookHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "600" },
    {
      tag: [tags.processingInstruction, tags.meta, tags.contentSeparator],
      color: "var(--m-mist)",
    },
  ]),
)

export function createBookExtensions(): Extension[] {
  return [
    markdown(),
    frontmatterField(),
    pageJointsField,
    pageLayer,
    structurePlugin,
    createTypingAids(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    drawSelection({ cursorBlinkRate: 1100 }),
    bookTheme,
    bookHighlight,
  ]
}
