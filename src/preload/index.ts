// The renderer's only gateway to the system: window.mbook. Generated from
// src/shared/ipc-contract.ts — one typed async function per ChannelName
// (ipcRenderer.invoke) plus on(EventName, cb) subscriptions that return an
// unsubscribe. The window is sandboxed, so this file uses only electron's
// ipcRenderer/contextBridge and zod-free pure JS — no node modules.

import { contextBridge, ipcRenderer } from "electron"
import type { IpcRendererEvent } from "electron"

import { channelRequest } from "../shared/ipc-contract"
import type {
  ChannelName,
  ChannelRequest,
  ChannelResponse,
  EventName,
  EventPayload,
} from "../shared/ipc-contract"

type Invokers = {
  [C in ChannelName]: (payload: ChannelRequest<C>) => Promise<ChannelResponse<C>>
}

type Subscribe = <E extends EventName>(
  event: E,
  callback: (payload: EventPayload<E>) => void,
) => () => void

export type MbookBridge = Invokers & { on: Subscribe }

function buildInvokers(): Invokers {
  const channels = Object.keys(channelRequest) as ChannelName[]

  const entries = channels.map(
    (channel): [string, (payload: unknown) => Promise<unknown>] => [
      channel,
      (payload: unknown) => ipcRenderer.invoke(channel, payload),
    ],
  )

  return Object.fromEntries(entries) as Invokers
}

const on: Subscribe = (event, callback) => {
  const listener = (_e: IpcRendererEvent, payload: unknown) =>
    callback(payload as EventPayload<typeof event>)

  ipcRenderer.on(event, listener)

  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

const bridge: MbookBridge = {
  ...buildInvokers(),
  on,
}

contextBridge.exposeInMainWorld("mbook", bridge)
