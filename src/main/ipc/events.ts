import { BrowserWindow } from "electron"

import type { EventName, EventPayload } from "../../shared/ipc-contract"

// Main -> renderer events are streamed to whichever window is open at emit time;
// a menu action can fire while a dialog holds the window, so the lookup is lazy.
// When no window exists the send is a silent no-op.
export function emitEvent<E extends EventName>(
  event: E,
  payload: EventPayload<E>,
): void {
  const first = BrowserWindow.getAllWindows()[0]

  switch (first) {
    case undefined:
      return
    default:
      first.webContents.send(event, payload)
      return
  }
}
