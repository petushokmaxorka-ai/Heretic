// Preload — the only bridge. Renderer gets typed verbs, nothing more.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BrainConfig, type TrustMode } from '../shared/ipc'

const api = {
  runSession: (task: string, brain: BrainConfig, trust: TrustMode, advisor?: BrainConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SESSION_RUN, { task, brain, advisor, trust }),
  scanBrains: (): Promise<{ name: string; baseUrl: string; models: string[] }[]> =>
    ipcRenderer.invoke(IPC.BRAINS_SCAN),
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
