import { markdown } from "@codemirror/lang-markdown"
import { autocompletion } from "@codemirror/autocomplete"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { keymap } from "@codemirror/view"
import { EditorView, drawSelection } from "@codemirror/view"
import type { Extension } from "@codemirror/state"
import { tags } from "@lezer/highlight"
import { frontmatterField } from "./frontmatter-field"
import { structurePlugin } from "./structure-plugin"
import { glyphPlugin } from "./glyph-plugin"
import { paragraphPlugin } from "./paragraph-plugin"
import { createTypingAids } from "./aids-extension"
import { pageJointsField } from "./page-breaks"
import { pageLayer } from "./page-layer"
import { characterCompletions } from "./character-complete"
import { diagnosticsExtension } from "./diagnostics"

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
    // 14px = 10.5pt on the printed page (the sheet is mm-true, so CSS px map
    // 1:1 to physical size at zoom 1). UK/EU A5 / demy trade convention runs
    // 10–11pt body; Literata's print brief targets ~9–12pt, and its large
    // x-height makes 10.5pt read like 11pt of a classic book face.
    fontSize: "calc(14px * var(--mb-zoom, 1))",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--mb-serif)",
    // Book leading: print A5 runs ~1.3; 1.45 is the screen compromise — the
    // top of the trade convention's 120–145% band, airy enough for a backlit
    // page. The pagination model derives its lines-per-page from this.
    lineHeight: "1.45",
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
    // Set books justify and hyphenate; headings and ornaments opt back out
    // through their own text-align. Hyphenation needs the lang attribute the
    // content carries (contentAttributes below).
    textAlign: "justify",
    hyphens: "auto",
    "-webkit-hyphens": "auto",
  },
  // The base theme pads lines 6px left / 2px right — a caret allowance for
  // gutterless buffers. Inside the sheet's 18mm margins it only skews the
  // text column 2px off the page axis, so it goes.
  ".cm-line": {
    padding: "0",
  },
  // A hollow block, not a beam: an outline one average advance wide (0.5em,
  // the same figure the pagination model uses) framing the character the
  // caret sits on — the sheet stays ink-free under it.
  "& .cm-cursorLayer .cm-cursor": {
    border: "1px solid var(--m-gold)",
    width: "0.5em",
    marginLeft: "0",
    boxSizing: "border-box",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--m-tint-2) !important",
  },
  // The completion popup, dressed as an mdesign overlay: the translucent panel
  // material, a single hairline (R4), a square corner (R5), the small UI sans —
  // not the manuscript serif. Carried in the theme (not app.css) so it outranks
  // the autocomplete package's runtime-injected base theme by CM's own priority.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    background: "var(--m-overlay-bg)",
    border: "1px solid var(--m-hair)",
    borderRadius: "0",
    boxShadow: "var(--m-overlay-shadow)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--m-font-sans)",
    fontSize: "12.5px",
    maxHeight: "12em",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "3px 12px",
    borderLeft: "2px solid transparent",
    color: "var(--m-fog)",
    lineHeight: "1.5",
  },
  // Gold marks the one alive row (R1); the fill is a surface tint, not a new
  // colour (R3), so only the gold rule reads as accent.
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--m-tint) !important",
    borderLeftColor: "var(--m-gold)",
    color: "var(--m-ink)",
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
    glyphPlugin,
    paragraphPlugin,
    createTypingAids(),
    diagnosticsExtension(),
    // activateOnTyping so the list pops the instant `[` opens a binding; the
    // name is the whole row, so the icon column is suppressed.
    autocompletion({
      override: [characterCompletions],
      activateOnTyping: true,
      icons: false,
    }),
    // Portuguese hyphenation patterns hang off the content's language.
    EditorView.contentAttributes.of({ lang: "pt-BR" }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    drawSelection({ cursorBlinkRate: 1100 }),
    bookTheme,
    bookHighlight,
  ]
}
