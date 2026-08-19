// Renderer entry: pulls in the stylesheet chain (Tailwind → mdesign → app rules)
// and the self-hosted variable fonts, then builds the three-row chrome shell —
// drag titlebar, empty editor host (Step 4 mounts the editor here), status band.

import "./styles/app.css"

import "@fontsource-variable/literata"
import "@fontsource-variable/literata/wght-italic.css"
import "@fontsource-variable/inter"
import "@fontsource-variable/jetbrains-mono"

import { EditorView } from "@codemirror/view"

import interact from "interactjs"

import { Statusbar } from "./statusbar"
import type { StatusState } from "./statusbar"
import { Titlebar } from "./titlebar"
import { Navigator } from "./navigator"
import { CommandPalette } from "./command/palette"
import type { Command } from "./command/filter"
import { DocSession } from "./doc-session"
import { PageTracker } from "./page-tracker"
import { createEditor, programmatic } from "./editor/editor"
import type { DocReflow } from "./editor/editor"
import { setPageJoints } from "./editor/page-breaks"
import type { PageJoints } from "./editor/page-breaks"
import { firstLineOfPage } from "../shared/book/pagination"
import type { PageMap } from "../shared/book/pagination"
import { chapterList, chapterAtLine } from "../shared/book/outline"
import type { Chapter } from "../shared/book/outline"
import type { BookDoc } from "../shared/book/parse"

type Shell = {
  titlebar: HTMLElement
  docTitle: HTMLElement
  navToggle: HTMLElement
  editorHost: HTMLElement
  navHost: HTMLElement
  statusLeft: HTMLElement
  statusRight: HTMLElement
}

function buildShell(root: HTMLElement): Shell {
  const titlebar = element("div", ["mb-titlebar"])

  const navToggle = element("button", ["mb-side-toggle", "mb-nav-toggle"])
  navToggle.setAttribute("title", "Alternar navegador (⌘\\)")
  navToggle.appendChild(railGlyph(10))
  titlebar.appendChild(navToggle)

  const docTitle = element("div", ["mb-doc-title"])
  docTitle.textContent = "untitled"
  titlebar.appendChild(docTitle)

  const editorHost = element("div", ["mb-editor-host"])

  const navHost = element("div", ["mb-nav"])

  const statusbar = element("div", ["m-statusbar", "mb-statusbar"])
  const statusLeft = element("span", [])
  const statusRight = element("span", [])
  statusbar.appendChild(statusLeft)
  statusbar.appendChild(statusRight)

  root.appendChild(titlebar)
  root.appendChild(editorHost)
  root.appendChild(navHost)
  root.appendChild(statusbar)

  return { titlebar, docTitle, navToggle, editorHost, navHost, statusLeft, statusRight }
}

// The rail glyph: a window frame with its divider at x — 10 reads as the
// right-hand rail.
function railGlyph(dividerX: number): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 16 14")
  svg.setAttribute("width", "16")
  svg.setAttribute("height", "14")

  const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect")
  frame.setAttribute("x", "1")
  frame.setAttribute("y", "1")
  frame.setAttribute("width", "14")
  frame.setAttribute("height", "12")
  frame.setAttribute("rx", "2.5")
  frame.setAttribute("fill", "none")
  frame.setAttribute("stroke", "currentColor")
  frame.setAttribute("stroke-width", "1.2")
  svg.appendChild(frame)

  const divider = document.createElementNS("http://www.w3.org/2000/svg", "line")
  divider.setAttribute("x1", String(dividerX))
  divider.setAttribute("y1", "1.6")
  divider.setAttribute("x2", String(dividerX))
  divider.setAttribute("y2", "12.4")
  divider.setAttribute("stroke", "currentColor")
  divider.setAttribute("stroke-width", "1.2")
  svg.appendChild(divider)

  return svg
}

const NAV_COLLAPSE_KEY = "mbook.navigator.collapsed"

const NAV_WIDTH_KEY = "mbook.navigator.width"

const NAV_WIDTH_MIN = 188

const NAV_WIDTH_MAX = 420

const NAV_WIDTH_DEFAULT = 248

function storedNavWidth(raw: string | null): number {
  const parsed = Number(raw)

  switch (Number.isFinite(parsed) && parsed >= NAV_WIDTH_MIN && parsed <= NAV_WIDTH_MAX) {
    case true:
      return parsed
    case false:
      return NAV_WIDTH_DEFAULT
  }
}

function storedCollapsed(raw: string | null): boolean {
  switch (raw) {
    case "true":
      return true
    default:
      return false
  }
}

const ZOOM_LEVELS: readonly number[] = [0.5, 0.65, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const ZOOM_KEY = "mbook.zoom"

function storedZoom(raw: string | null): number {
  const parsed = Number(raw)

  switch (ZOOM_LEVELS.some((level) => level === parsed)) {
    case true:
      return parsed
    case false:
      return 1
  }
}

// One joint per rendered sheet boundary: the first line of every page after
// the first. Deduped because a block spanning several estimated pages answers
// the same first line for each of them — those merge into one taller sheet, so
// folios are numbered by rendered sheet, not by estimated page. The running
// header names the chapter the new sheet falls in, silenced on the sheet that
// opens the chapter itself.
function pageJointsFor(doc: BookDoc, map: PageMap): PageJoints {
  const lines: number[] = []

  for (let page = 2; page <= map.totalPages; page += 1) {
    lines.push(firstLineOfPage(map, page))
  }

  const unique = [...new Set(lines)]

  const chapters = chapterList(doc)

  const joints = unique.map((line, index) => ({
    line,
    folio: index + 1,
    header: runningHeader(chapters, line),
  }))

  return { joints, lastFolio: unique.length + 1 }
}

function runningHeader(chapters: readonly Chapter[], line: number): string {
  const current = chapterAtLine(chapters, line)

  switch (current.kind) {
    case "none":
      return ""
    case "some":
      break
  }

  const chapter = chapters[current.value]

  switch (chapter) {
    case undefined:
      return ""
    default:
      break
  }

  switch (chapter.line === line) {
    case true:
      return ""
    case false:
      return headerLabel(chapter, current.value)
  }
}

// A running header carries the chapter's bare name, in the classic manner;
// only a nameless chapter falls back to its ordinal.
function headerLabel(chapter: Chapter, index: number): string {
  switch (chapter.title === "") {
    case true:
      return `Capítulo ${index + 1}`
    case false:
      return chapter.title
  }
}

function element(tag: string, classes: ReadonlyArray<string>): HTMLElement {
  const node = document.createElement(tag)

  node.classList.add(...classes)

  return node
}

// Holds the two independently-owned halves of the status band and re-renders the
// whole state whenever either changes, so DocSession's file setter and the page
// tracker's counts setter never overwrite each other's cell.
class StatusModel {
  private readonly view: Statusbar
  private file: StatusState["file"]
  private counts: StatusState["counts"]
  private zoom: StatusState["zoom"]

  constructor(view: Statusbar) {
    this.view = view
    this.file = { kind: "untitled" }
    this.counts = { kind: "empty" }
    this.zoom = 1
  }

  setFile(file: StatusState["file"]): void {
    this.file = file

    this.render()
  }

  setCounts(counts: StatusState["counts"]): void {
    this.counts = counts

    this.render()
  }

  setZoom(zoom: StatusState["zoom"]): void {
    this.zoom = zoom

    this.render()
  }

  private render(): void {
    this.view.render({ file: this.file, counts: this.counts, zoom: this.zoom })
  }
}

function readLines(view: EditorView): string[] {
  const doc = view.state.doc
  const lines: string[] = []

  for (let n = 1; n <= doc.lines; n += 1) {
    lines.push(doc.line(n).text)
  }

  return lines
}

function cursorZeroBasedLine(view: EditorView): number {
  const head = view.state.selection.main.head

  return view.state.doc.lineAt(head).number - 1
}

const app = document.getElementById("app")

switch (app) {
  case null:
    // Provably present in index.html; an absent root is an unrecoverable invariant.
    throw new Error("missing #app root")
  default: {
    const shell = buildShell(app)

    const statusbar = new Statusbar(shell.statusLeft, shell.statusRight)

    const statusModel = new StatusModel(statusbar)

    const titlebar = new Titlebar(shell.docTitle)

    // DocSession pushes file state through one seam; the titlebar strip and the
    // status band both listen so they can never disagree about the open book.
    const fileView = {
      setFile: (file: StatusState["file"]) => {
        statusModel.setFile(file)

        titlebar.setFile(file)
      },
    }

    const tracker = new PageTracker()

    // The editor's hooks forward through a shim so they can be wired before the
    // view and DocSession they close over exist (the wiring is mutually recursive).
    const hook: { changed: () => void; reflow: (change: DocReflow) => void } = {
      changed: () => {},
      reflow: () => {},
    }

    const view = createEditor(shell.editorHost, {
      onDocChanged: () => hook.changed(),
      onReflow: (change) => hook.reflow(change),
    })

    const navigate = (zeroBasedLine: number) => {
      const clamped = Math.min(zeroBasedLine + 1, view.state.doc.lines)
      const target = view.state.doc.line(clamped).from

      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "start", yMargin: 72 }),
      })

      view.focus()
    }

    const navigator = new Navigator({ host: shell.navHost, onNavigate: navigate })

    navigator.setCollapsed(storedCollapsed(localStorage.getItem(NAV_COLLAPSE_KEY)))

    const toggleNavigator = () => {
      navigator.setCollapsed(!navigator.collapsed())

      localStorage.setItem(NAV_COLLAPSE_KEY, String(navigator.collapsed()))
    }

    shell.navToggle.addEventListener("click", toggleNavigator)

    // The rail resizes from its left edge (interactjs owns the edge grab and
    // the col-resize cursor). Width lives in the --mb-nav-w custom property so
    // every pinned inner width follows, and so the collapsed class's width:0
    // still outranks it. The page never moves — the rail is an overlay.
    const applyNavWidth = (px: number) => {
      app.style.setProperty("--mb-nav-w", `${px}px`)
    }

    let navWidth = storedNavWidth(localStorage.getItem(NAV_WIDTH_KEY))

    applyNavWidth(navWidth)

    interact(shell.navHost).resizable({
      edges: { left: true, right: false, top: false, bottom: false },
      listeners: {
        start: () => {
          shell.navHost.classList.add("resizing")
        },
        move: (event) => {
          switch (navigator.collapsed()) {
            case true:
              return
            case false:
              break
          }

          navWidth = Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, event.rect.width))

          applyNavWidth(navWidth)
        },
        end: () => {
          shell.navHost.classList.remove("resizing")

          localStorage.setItem(NAV_WIDTH_KEY, String(navWidth))
        },
      },
    })

    // Page zoom, Google-Docs style: stepped levels applied through the --mb-zoom
    // factor the sheet's dimensions and type are multiplied by, so the page
    // scales without reflowing. Chrome around the page stays 1:1.
    let zoom = storedZoom(localStorage.getItem(ZOOM_KEY))

    const applyZoom = (next: number) => {
      zoom = next

      document.documentElement.style.setProperty("--mb-zoom", String(next))

      localStorage.setItem(ZOOM_KEY, String(next))

      statusModel.setZoom(next)

      // The zoom factor resizes the sheet purely in CSS, inside an unchanged
      // scroller — nothing CodeMirror observes moves, so ask for the measure
      // cycle explicitly or line layout and the page layer go stale.
      view.requestMeasure()
    }

    applyZoom(zoom)

    const stepZoom = (delta: 1 | -1) => {
      const index = ZOOM_LEVELS.findIndex((level) => level === zoom)

      const next = ZOOM_LEVELS[index + delta]

      switch (next) {
        case undefined:
          return
        default:
          applyZoom(next)
      }
    }

    window.addEventListener("keydown", (event) => {
      switch (event.metaKey) {
        case false:
          return
        case true:
          break
      }

      switch (event.key) {
        case "\\":
          event.preventDefault()

          toggleNavigator()

          return
        case "=":
        case "+":
          event.preventDefault()

          stepZoom(1)

          return
        case "-":
          event.preventDefault()

          stepZoom(-1)

          return
        case "0":
          event.preventDefault()

          applyZoom(1)

          return
        default:
          return
      }
    })

    const pushCounts = () => {
      const cursorLine = cursorZeroBasedLine(view)

      statusModel.setCounts(tracker.counts(cursorLine))

      navigator.setCurrent({ page: tracker.pageAtCursorLine(cursorLine), cursorLine })
    }

    const renderDerived = () => {
      const snapshot = tracker.snapshot()

      navigator.render(snapshot.doc, snapshot.pageMap)

      view.dispatch({ effects: setPageJoints.of(pageJointsFor(snapshot.doc, snapshot.pageMap)) })

      pushCounts()
    }

    // Re-parsing on every keystroke would tax typing; debounce the heavy path and
    // keep caret-only moves on the cheap cached read.
    let recomputeTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleRecompute = () => {
      clearTimeout(recomputeTimer)

      recomputeTimer = setTimeout(() => {
        tracker.recompute(readLines(view))

        renderDerived()
      }, 150)
    }

    hook.reflow = (change) => {
      switch (change.kind) {
        case "doc":
          scheduleRecompute()
          return
        case "selection":
          pushCounts()
          return
      }
    }

    const getContent = () => view.state.doc.toString()

    const setContent = (text: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: programmatic.of(true),
      })
    }

    const session = new DocSession({
      bridge: window.mbook,
      statusbar: fileView,
      getContent,
      setContent,
      debounceMs: 800,
    })

    hook.changed = () => session.onDocChanged()

    window.mbook.on("evt:menu", (payload) => {
      void session.onMenu(payload.action)
    })

    window.addEventListener("blur", () => {
      void session.flush()
    })

    void session.boot().then(() => {
      tracker.recompute(readLines(view))

      renderDerived()
    })

    // ── The command bar ────────────────────────────────────────────────────
    // Commands are built fresh on every open from the live seams this root
    // already owns — chapters from the tracker's snapshot, view toggles, the
    // session's file actions — and the recent books join asynchronously the
    // moment the ledger answers.
    const palette = new CommandPalette({
      host: document.body,
      onClose: () => view.focus(),
    })

    const bookName = (path: string): string => {
      const leaf = path.split("/").at(-1)

      switch (leaf === undefined) {
        case true:
          return path
        case false:
          return leaf!.replace(/\.md$/, "")
      }
    }

    const paletteCommands = (): Command[] => {
      const snapshot = tracker.snapshot()
      const chapters = chapterList(snapshot.doc)

      const navigation: Command[] = [
        { id: "nav-rosto", group: "navegação", title: "Página de rosto", hint: "", run: () => navigate(0) },
        ...chapters.map((chapter, index) => ({
          id: `nav-cap-${index}`,
          group: "navegação",
          title: `Capítulo ${index + 1} · ${chapter.title}`,
          hint: "",
          run: () => navigate(chapter.line),
        })),
      ]

      const display: Command[] = [
        { id: "view-nav", group: "exibição", title: "Alternar navegador", hint: "⌘\\", run: toggleNavigator },
        { id: "view-zoom-in", group: "exibição", title: "Ampliar página", hint: "⌘+", run: () => stepZoom(1) },
        { id: "view-zoom-out", group: "exibição", title: "Reduzir página", hint: "⌘−", run: () => stepZoom(-1) },
        { id: "view-zoom-reset", group: "exibição", title: "Zoom 100%", hint: "⌘0", run: () => applyZoom(1) },
      ]

      const book: Command[] = [
        { id: "book-new", group: "livro", title: "Novo livro", hint: "", run: () => void session.onMenu("new") },
        { id: "book-open", group: "livro", title: "Abrir…", hint: "", run: () => void session.onMenu("open") },
        { id: "book-save", group: "livro", title: "Guardar", hint: "", run: () => void session.onMenu("save") },
        { id: "book-save-as", group: "livro", title: "Guardar como…", hint: "", run: () => void session.onMenu("save-as") },
      ]

      return [...navigation, ...display, ...book]
    }

    const openPalette = () => {
      palette.open(paletteCommands())

      void window.mbook["book:recent"]({}).then((result) => {
        switch (result.ok) {
          case false:
            return
          case true:
            break
        }

        palette.extend(
          result.value.entries.map((entry) => ({
            id: `recent-${entry.path}`,
            group: "recentes",
            title: bookName(entry.path),
            hint: "",
            run: () => void session.openPathDoc(entry.path),
          })),
        )
      })
    }

    window.addEventListener("keydown", (event) => {
      switch (event.metaKey && event.key === "k") {
        case false:
          return
        case true:
          break
      }

      event.preventDefault()

      switch (palette.isOpen()) {
        case true:
          palette.close()
          return
        case false:
          openPalette()
          return
      }
    })
  }
}
