// The translucent main window and everything wired to it: creation with the
// sandboxed webPreferences and macOS vibrancy, navigation hardening so no foreign
// document can replace the app, and renderer loading (dev URL vs bundled file).
//
// transparent:true is deliberately NOT set — it reintroduces a macOS resize
// artifact. A clear backgroundColor over "under-window" vibrancy gives the
// translucent look without it.

import { join } from "node:path"

import { app, BrowserWindow, shell } from "electron"

import { boundsFor, loadWindowState, trackWindowState } from "./window-state"

export function createMainWindow(): BrowserWindow {
  const bounds = boundsFor(loadWindowState())

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 20 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.on("ready-to-show", () => {
    window.show()
  })

  trackWindowState(window)

  hardenNavigation(window)

  loadRenderer(window)

  return window
}

// Every window-open is denied; an http(s) target is handed to the OS browser and
// any other scheme is dropped. In-page navigation away from the app's own
// document is blocked so no content can replace the renderer.
function hardenNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler((details) => windowOpenPolicy(details.url))

  window.webContents.on("will-navigate", (event, url) => {
    switch (isOwnUrl(url)) {
      case true:
        return
      case false:
        event.preventDefault()
        return
    }
  })
}

function windowOpenPolicy(url: string): { action: "deny" } {
  switch (isExternalWebUrl(url)) {
    case true:
      void shell.openExternal(url)
      return { action: "deny" }
    case false:
      return { action: "deny" }
  }
}

function isExternalWebUrl(url: string): boolean {
  const https = url.startsWith("https://")

  const http = url.startsWith("http://")

  return https || http
}

// The app's own document is the dev server URL (electron-vite dev) or the bundled
// file: index. Anything else is foreign content trying to take over.
function isOwnUrl(url: string): boolean {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"]

  switch (devServerUrl) {
    case undefined:
      return url.startsWith("file://")
    default:
      return url.startsWith(devServerUrl)
  }
}

function loadRenderer(window: BrowserWindow): void {
  const devServerUrl = process.env["ELECTRON_RENDERER_URL"]

  switch (devServerUrl) {
    case undefined:
      void window.loadFile(join(app.getAppPath(), "out/renderer/index.html"))
      return
    default:
      void window.loadURL(devServerUrl)
      return
  }
}
