// Composition root: acquire the single-instance lock, then on ready create the
// translucent window and own the macOS-shaped lifecycle. A second launch that
// loses the lock quits immediately, handing focus back to the first instance.

import { app, BrowserWindow } from "electron"

import { registerIpcHandlers } from "./ipc/handlers"
import { installMenu } from "./menu"
import { createMainWindow } from "./window"

app.setName("mbook")

function start(): void {
  app
    .whenReady()
    .then(() => {
      registerIpcHandlers()

      installMenu()

      createMainWindow()

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
