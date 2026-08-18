// The navigator: the book's one navigation rail, on the editor's right edge.
// Chapters are small-caps section heads with their pages nested beneath as A5
// thumbnails on the same paper as the real sheets; pages before the first
// chapter sit under "Página de rosto". The cursor's chapter carries the gold
// 2px edge on its head, the cursor's page on its thumbnail (R1 — the open
// item's edge). Clicks report through a single injected onNavigate seam.
//
// Rendering diffs on two levels: the section structure (labels and page
// partition) rebuilds the DOM only when it changes, and each thumbnail's
// canvas repaints only when its page's skeleton rows changed — typing repaints
// touched pages, not the rail.

import type { PageMap, SkeletonRow } from "../shared/book/pagination"
import { firstLineOfPage, pageAtLine, LINES_PER_PAGE } from "../shared/book/pagination"
import type { BookDoc } from "../shared/book/parse"
import { chapterList, chapterAtLine } from "../shared/book/outline"
import type { Chapter } from "../shared/book/outline"
import type { Optional } from "../shared/optional"
import { assertNever } from "../shared/assert"

export type NavigatorDeps = {
  host: HTMLElement
  onNavigate: (line: number) => void
}

export type NavigatorCurrent = { page: number; cursorLine: number }

type Section = {
  label: string
  navLine: number
  pages: readonly number[]
  chapterIndex: Optional<number>
}

type Card = { root: HTMLElement; canvas: HTMLCanvasElement; rows: readonly SkeletonRow[] }

// Render resolution, not display size — cells stretch with the resizable
// rail, so canvases are drawn at the widest cell they can reach to stay crisp.
const CARD_WIDTH = 128
const CARD_HEIGHT = Math.round((CARD_WIDTH * 210) / 148)

export class Navigator {
  private readonly deps: NavigatorDeps
  private readonly scroll: HTMLElement
  private sections: readonly Section[]
  private sectionHeads: HTMLElement[]
  private cards: Map<number, Card>
  private latestMap: PageMap
  private chapters: readonly Chapter[]
  private current: NavigatorCurrent

  constructor(deps: NavigatorDeps) {
    this.deps = deps
    this.sections = []
    this.sectionHeads = []
    this.cards = new Map()
    this.latestMap = { totalPages: 1, entries: [], pages: [] }
    this.chapters = []
    this.current = { page: 1, cursorLine: 0 }

    this.scroll = document.createElement("div")
    this.scroll.classList.add("mb-nav-scroll")
    deps.host.appendChild(this.scroll)
  }

  render(doc: BookDoc, map: PageMap): void {
    this.latestMap = map
    this.chapters = chapterList(doc)

    const sections = computeSections(this.chapters, map)

    switch (sameSections(this.sections, sections)) {
      case true:
        this.repaintChanged(map)
        break
      case false:
        this.sections = sections

        this.rebuild(map)
        break
    }

    this.applyCurrent()
  }

  setCurrent(current: NavigatorCurrent): void {
    this.current = current

    this.applyCurrent()
  }

  setCollapsed(collapsed: boolean): void {
    this.deps.host.classList.toggle("collapsed", collapsed)
  }

  collapsed(): boolean {
    return this.deps.host.classList.contains("collapsed")
  }

  private rebuild(map: PageMap): void {
    this.scroll.textContent = ""
    this.cards = new Map()
    this.sectionHeads = []

    for (const section of this.sections) {
      const head = document.createElement("div")

      head.classList.add("mb-nav-sect")
      head.textContent = section.label
      head.addEventListener("mousedown", (event) => {
        event.preventDefault()

        this.deps.onNavigate(section.navLine)
      })

      this.scroll.appendChild(head)
      this.sectionHeads.push(head)

      const grid = document.createElement("div")
      grid.classList.add("mb-nav-grid")
      this.scroll.appendChild(grid)

      for (const page of section.pages) {
        grid.appendChild(this.buildCard(page, rowsFor(map, page)).root)
      }
    }
  }

  private repaintChanged(map: PageMap): void {
    for (const [page, card] of this.cards) {
      const rows = rowsFor(map, page)

      switch (sameRows(card.rows, rows)) {
        case true:
          continue
        case false:
          card.rows = rows

          drawPage(card.canvas, rows)

          continue
      }
    }
  }

  private buildCard(page: number, rows: readonly SkeletonRow[]): Card {
    const root = document.createElement("div")
    root.classList.add("mb-nav-card")

    const canvas = document.createElement("canvas")
    root.appendChild(canvas)

    const num = document.createElement("div")
    num.classList.add("mb-nav-num")
    num.textContent = String(page)
    root.appendChild(num)

    root.addEventListener("mousedown", (event) => {
      event.preventDefault()

      this.deps.onNavigate(firstLineOfPage(this.latestMap, page))
    })

    drawPage(canvas, rows)

    const card: Card = { root, canvas, rows }

    this.cards.set(page, card)

    return card
  }

  private applyCurrent(): void {
    const currentChapter = chapterAtLine(this.chapters, this.current.cursorLine)

    this.sections.forEach((section, index) => {
      const head = this.sectionHeads[index]

      if (head !== undefined) {
        head.classList.toggle("current", isCurrentSection(section, currentChapter))
      }
    })

    for (const [page, card] of this.cards) {
      card.root.classList.toggle("current", page === this.current.page)
    }

    const card = this.cards.get(this.current.page)

    if (card !== undefined) {
      card.root.scrollIntoView({ block: "nearest" })
    }
  }
}

function rowsFor(map: PageMap, page: number): readonly SkeletonRow[] {
  const rows = map.pages[page - 1]

  switch (rows) {
    case undefined:
      return []
    default:
      return rows
  }
}

function computeSections(chapters: readonly Chapter[], map: PageMap): Section[] {
  switch (chapters.length === 0) {
    case true:
      return [
        {
          label: "Páginas",
          navLine: 0,
          pages: pageRange(1, map.totalPages),
          chapterIndex: { kind: "none" },
        },
      ]
    case false:
      break
  }

  const sections: Section[] = []

  const first = chapters[0]

  const firstChapterPage = first === undefined ? 1 : pageAtLine(map, first.line)

  switch (firstChapterPage > 1) {
    case true:
      sections.push({
        label: "Página de rosto",
        navLine: 0,
        pages: pageRange(1, firstChapterPage - 1),
        chapterIndex: { kind: "none" },
      })
      break
    case false:
      break
  }

  chapters.forEach((chapter, index) => {
    const startPage = pageAtLine(map, chapter.line)

    const next = chapters[index + 1]

    const endPage = next === undefined ? map.totalPages : pageAtLine(map, next.line) - 1

    sections.push({
      label: sectionLabel(chapter, index),
      navLine: chapter.line,
      pages: pageRange(startPage, Math.max(startPage, endPage)),
      chapterIndex: { kind: "some", value: index },
    })
  })

  return sections
}

function sectionLabel(chapter: Chapter, index: number): string {
  switch (chapter.title === "") {
    case true:
      return `${index + 1} · Capítulo ${index + 1}`
    case false:
      return `${index + 1} · ${chapter.title}`
  }
}

function pageRange(from: number, to: number): number[] {
  const pages: number[] = []

  for (let page = from; page <= to; page += 1) {
    pages.push(page)
  }

  return pages
}

// The front section (no chapter) is current when the cursor sits before every
// chapter; a chapter section is current when the cursor's chapter matches.
function isCurrentSection(section: Section, currentChapter: Optional<number>): boolean {
  switch (section.chapterIndex.kind) {
    case "none":
      return currentChapter.kind === "none"
    case "some":
      break
  }

  switch (currentChapter.kind) {
    case "none":
      return false
    case "some":
      return currentChapter.value === section.chapterIndex.value
    default:
      return assertNever(currentChapter)
  }
}

function sameSections(a: readonly Section[], b: readonly Section[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((section, index) => {
    const other = b[index]

    if (other === undefined) {
      return false
    }

    return (
      section.label === other.label &&
      section.navLine === other.navLine &&
      section.pages.length === other.pages.length &&
      section.pages.every((page, at) => page === other.pages[at])
    )
  })
}

function sameRows(a: readonly SkeletonRow[], b: readonly SkeletonRow[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((row, index) => {
    const other = b[index]

    if (other === undefined) {
      return false
    }

    return row.kind === other.kind && row.fill === other.fill
  })
}

function drawPage(canvas: HTMLCanvasElement, rows: readonly SkeletonRow[]): void {
  const scale = window.devicePixelRatio

  canvas.width = Math.round(CARD_WIDTH * scale)
  canvas.height = Math.round(CARD_HEIGHT * scale)

  const context = canvas.getContext("2d")

  if (context === null) {
    return
  }

  context.scale(scale, scale)

  const ink = tokenColor("--m-mist")
  const strong = tokenColor("--m-fog")

  const padX = CARD_WIDTH * 0.13
  const padY = CARD_HEIGHT * 0.09
  const innerW = CARD_WIDTH - padX * 2
  const rowH = (CARD_HEIGHT - padY * 2) / LINES_PER_PAGE
  const barH = Math.min(2, Math.max(1, rowH * 0.45))

  rows.forEach((row, index) => {
    const y = padY + index * rowH + (rowH - barH) / 2

    switch (row.kind) {
      case "gap":
        return
      case "text":
        context.fillStyle = withAlpha(ink, 0.45)

        context.fillRect(padX, y, innerW * row.fill, barH)

        return
      case "chapter":
        context.fillStyle = withAlpha(strong, 0.85)

        context.fillRect(padX, y, innerW * row.fill, barH + 0.6)

        return
      case "title":
        context.fillStyle = withAlpha(strong, 0.85)

        context.fillRect(padX + (innerW * (1 - row.fill)) / 2, y, innerW * row.fill, barH + 0.6)

        return
      case "ornament":
        context.fillStyle = withAlpha(ink, 0.6)

        context.fillRect(padX + (innerW * (1 - row.fill)) / 2, y, innerW * row.fill, barH)

        return
      default:
        return assertNever(row.kind)
    }
  })
}

function tokenColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function withAlpha(color: string, alpha: number): string {
  switch (color.startsWith("#") && color.length === 7) {
    case true: {
      const r = parseInt(color.slice(1, 3), 16)
      const g = parseInt(color.slice(3, 5), 16)
      const b = parseInt(color.slice(5, 7), 16)

      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    case false:
      return color
  }
}
