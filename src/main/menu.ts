// The macOS application menu. The File items own no filesystem logic — each is a
// pure trigger that emits evt:menu, and the renderer's DocSession decides what
// open/save/new mean against the live document. Edit carries the default roles so
// CodeMirror gets working system clipboard and undo shortcuts; Window is standard.

import { Menu, app } from "electron"
import type { MenuItemConstructorOptions } from "electron"

import { emitEvent } from "./ipc/events"

export function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()))
}

function template(): MenuItemConstructorOptions[] {
  return [appMenu(), fileMenu(), editMenu(), windowMenu()]
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
