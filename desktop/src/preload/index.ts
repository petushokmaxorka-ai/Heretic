// Preload — the only bridge. Renderer gets typed verbs, nothing more.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BrainConfig, type TrustMode, type ChatRequestPayload, type AutoRequestPayload } from '../shared/ipc'

const api = {
  runSession: (task: string, brain: BrainConfig, trust: TrustMode, advisor?: BrainConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SESSION_RUN, { task, brain, advisor, trust }),
  scanBrains: (): Promise<{ name: string; baseUrl: string; models: string[] }[]> =>
    ipcRenderer.invoke(IPC.BRAINS_SCAN),
  autoSend: (payload: AutoRequestPayload): Promise<{ kind: string; answer: string; sources: { title: string; url: string }[]; ok?: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.AUTO_SEND, payload),
  chatSend: (payload: ChatRequestPayload): Promise<{ answer: string; sources: { title: string; url: string; snippet: string }[]; error?: string }> =>
    ipcRenderer.invoke(IPC.CHAT_SEND, payload),
  onChatDelta: (cb: (d: string) => void): (() => void) => {
    const h = (_e: unknown, v: { delta: string }): void => cb(v.delta)
    ipcRenderer.on(IPC.CHAT_DELTA, h)
    return () => ipcRenderer.removeListener(IPC.CHAT_DELTA, h)
  },
  onChatStatus: (cb: (line: string) => void): (() => void) => {
    const h = (_e: unknown, v: { line: string }): void => cb(v.line)
    ipcRenderer.on(IPC.CHAT_STATUS, h)
    return () => ipcRenderer.removeListener(IPC.CHAT_STATUS, h)
  },
  stopSession: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SESSION_STOP),
  stopChat: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.CHAT_STOP),
  saveBrains: (cfg: { url?: string; model?: string; key?: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.BRAINS_SAVE, cfg),
  loadBrains: (): Promise<{ ok: boolean; url: string; model: string; key: string }> =>
    ipcRenderer.invoke(IPC.BRAINS_LOAD),
  onThinking: (cb: (t: string) => void): (() => void) => {
    const h = (_e: unknown, v: { text: string }): void => cb(v.text)
    ipcRenderer.on(IPC.SESSION_THINKING, h)
    return () => ipcRenderer.removeListener(IPC.SESSION_THINKING, h)
  },
  decideApproval: (id: number, ok: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.APPROVAL_DECIDE, { id, ok }),
  onStep: (cb: (step: { index: number; title: string; detail: string; verdict: string; note?: string; kind: string }) => void): (() => void) => {
    const handler = (_e: unknown, step: unknown): void => cb(step as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.SESSION_STEP, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_STEP, handler)
  },
  onFinal: (cb: (result: { ok: boolean; final: string }) => void): (() => void) => {
    const handler = (_e: unknown, r: unknown): void => cb(r as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.SESSION_FINAL, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_FINAL, handler)
  },
  onApproval: (cb: (req: { id: number; action: string; detail: string }) => void): (() => void) => {
    const handler = (_e: unknown, req: unknown): void => cb(req as Parameters<typeof cb>[0])
    ipcRenderer.on(IPC.APPROVAL_REQUEST, handler)
    return () => ipcRenderer.removeListener(IPC.APPROVAL_REQUEST, handler)
  }
}

contextBridge.exposeInMainWorld('heretic', api)
export type HereticApi = typeof api
