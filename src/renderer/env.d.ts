/// <reference types="vite/client" />

import type { MbookBridge } from "../preload/index"

declare global {
  interface Window {
    mbook: MbookBridge
  }
}

export {}
