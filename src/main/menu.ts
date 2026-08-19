// The macOS application menu — the app's control surface. Every item owns no
// logic: each is a pure trigger that emits a typed evt:menu, and the renderer
// decides what it means against the live document (DocSession for the file
// actions, the composition root for view and navigation). Edit carries the
// default roles so CodeMirror gets working system clipboard and undo; Window
// is standard. Two submenus are LIVE and rebuild the menu when their data
// changes: File ▸ Open Recent mirrors the recent ledger, and Go lists the
// book's chapters (⌘1…⌘9) — the renderer streams chapter titles up through
// menu:outline, and a Go click travels back down as an index the renderer
// resolves against the live outline, so line drift while typing never forces
// a menu rebuild.

import { Menu, app } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { basename } from "node:path"

import { emitEvent } from "./ipc/events"

let chapterTitles: readonly string[] = []
let recentPaths: readonly string[] = []

export function installMenu(): void {
  rebuild()
}

// The renderer's outline stream: rebuild only when the titles actually change.
export function setOutline(titles: readonly string[]): void {
  switch (sameList(titles, chapterTitles)) {
    case true:
      return
    case false:
      chapterTitles = [...titles]
      rebuild()
      return
  }
}

export function setRecents(paths: readonly string[]): void {
  switch (sameList(paths, recentPaths)) {
    case true:
      return
    case false:
      recentPaths = [...paths]
      rebuild()
      return
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function rebuild(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()))
}

function template(): MenuItemConstructorOptions[] {
  return [appMenu(), fileMenu(), editMenu(), viewMenu(), goMenu(), windowMenu()]
}

function appMenu(): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  }
}

function fileMenu(): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      {
        label: "New",
        accelerator: "CmdOrCtrl+N",
        click: () => emitEvent("evt:menu", { action: "new" }),
      },
      {
        label: "Open…",
        accelerator: "CmdOrCtrl+O",
        click: () => emitEvent("evt:menu", { action: "open" }),
      },
      openRecentMenu(),
      { type: "separator" },
      {
        label: "Save",
        accelerator: "CmdOrCtrl+S",
        click: () => emitEvent("evt:menu", { action: "save" }),
      },
      {
        label: "Save As…",
        accelerator: "Shift+CmdOrCtrl+S",
        click: () => emitEvent("evt:menu", { action: "save-as" }),
      },
    ],
  }
}

function openRecentMenu(): MenuItemConstructorOptions {
  switch (recentPaths.length === 0) {
    case true:
      return { label: "Open Recent", enabled: false }
    case false:
      break
  }

  return {
    label: "Open Recent",
    submenu: recentPaths.map((path) => ({
      label: basename(path).replace(/\.md$/, ""),
      click: () => emitEvent("evt:menu", { action: "open-path", path }),
    })),
  }
}

function editMenu(): MenuItemConstructorOptions {
  return {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  }
}

function viewMenu(): MenuItemConstructorOptions {
  return {
    label: "View",
    submenu: [
      {
        label: "Toggle Navigator",
        accelerator: "CmdOrCtrl+\\",
        click: () => emitEvent("evt:menu", { action: "toggle-navigator" }),
      },
      { type: "separator" },
      {
        label: "Zoom In",
        accelerator: "CmdOrCtrl+Plus",
        click: () => emitEvent("evt:menu", { action: "zoom-in" }),
      },
      {
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        click: () => emitEvent("evt:menu", { action: "zoom-out" }),
      },
      {
        label: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        click: () => emitEvent("evt:menu", { action: "zoom-reset" }),
      },
    ],
  }
}

// ⌘1…⌘9 reach the first nine chapters; the book's own titles are the labels.
function goMenu(): MenuItemConstructorOptions {
  const chapters = chapterTitles.map((title, index) => chapterItem(title, index))

  return {
    label: "Go",
    submenu: [
      {
        label: "Title Page",
        click: () => emitEvent("evt:menu", { action: "go-title" }),
      },
      { type: "separator" },
      ...chapters,
    ],
  }
}

function chapterItem(title: string, index: number): MenuItemConstructorOptions {
  const item: MenuItemConstructorOptions = {
    label: `${index + 1} · ${title}`,
    click: () => emitEvent("evt:menu", { action: "go-chapter", index }),
  }

  switch (index < 9) {
    case true:
      return { ...item, accelerator: `CmdOrCtrl+${index + 1}` }
    case false:
      return item
  }
}

function windowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    role: "window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ],
  }
}
