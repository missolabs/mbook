// Composition root: acquire the single-instance lock, then on ready create the
// translucent window and own the macOS-shaped lifecycle. A second launch that
// loses the lock quits immediately, handing focus back to the first instance.

import { app, BrowserWindow } from "electron"

import { primeMenuState, registerIpcHandlers } from "./ipc/handlers"
import { loadLingua, logLingua } from "./lingua"
import { setLingua } from "./lingua-holder"
import { installMenu } from "./menu"
import { createMainWindow } from "./window"

app.setName("mbook")

// Load the dictionaries in the background: the window must never wait on them,
// and a missing or corrupt lexicon just leaves the engine off. Its own Result is
// logged and parked in the holder for later steps; nothing here can fail boot.
function bootLingua(): void {
  loadLingua()
    .then((lingua) => {
      setLingua(lingua)

      logLingua(lingua)
    })
    .catch((caught: unknown) => {
      console.error("[mbook] lexicon load crashed", caught)
    })
}

function start(): void {
  app
    .whenReady()
    .then(() => {
      registerIpcHandlers()

      installMenu()

      primeMenuState()

      createMainWindow()

      bootLingua()

      app.on("activate", () => {
        const noWindows = BrowserWindow.getAllWindows().length === 0

        switch (noWindows) {
          case true:
            createMainWindow()
            return
          case false:
            return
        }
      })
    })
    .catch((caught: unknown) => {
      // A composition-root failure must never become an unhandled rejection:
      // without a window the app is a zombie, so log the cause and quit loudly.
      console.error("[mbook] boot failed", caught)

      app.quit()
    })
}

const gotLock = app.requestSingleInstanceLock()

switch (gotLock) {
  case false:
    app.quit()
    break
  case true:
    start()
    break
}

app.on("window-all-closed", () => {
  const isMac = process.platform === "darwin"

  switch (isMac) {
    case true:
      return
    case false:
      app.quit()
      return
  }
})
