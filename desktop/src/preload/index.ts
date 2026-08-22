// Preload — the only bridge. Renderer gets typed verbs, nothing more.

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type BrainConfig, type TrustMode, type ChatRequestPayload, type AutoRequestPayload } from '../shared/ipc'

const api = {
  runSession: (task: string, brain: BrainConfig, trust: TrustMode, advisor?: BrainConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SESSION_RUN, { task, brain, advisor, trust }),
  scanBrains: (): Promise<{ name: string; baseUrl: string; models: string[]; residents: string[] }[]> =>
    ipcRenderer.invoke(IPC.BRAINS_SCAN),
  autoSend: (payload: AutoRequestPayload & { persona?: string; images?: string[]; codexUrl?: string; codexModel?: string; workspace?: string; councilModels?: string[] }): Promise<{ kind: string; answer: string; sources: { title: string; url: string }[]; ok?: boolean; error?: string; tokens?: number; local?: boolean; replies?: { model: string; answer: string }[] }> =>
    ipcRenderer.invoke(IPC.AUTO_SEND, payload),
  chatSend: (payload: ChatRequestPayload): Promise<{ answer: string; sources: { title: string; url: string; snippet: string }[]; error?: string }> =>
    ipcRenderer.invoke(IPC.CHAT_SEND, payload),
  onChatDelta: (cb: (d: string, model?: string) => void): (() => void) => {
    const h = (_e: unknown, v: { delta: string; model?: string }): void => cb(v.delta, v.model)
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
  savePersona: (persona: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.PERSONA_SAVE, persona),
  loadPersona: (): Promise<{ ok: boolean; persona: string }> => ipcRenderer.invoke(IPC.PERSONA_LOAD),
  pickImages: (): Promise<{ ok: boolean; images: string[] }> => ipcRenderer.invoke(IPC.ATTACH_PICK),
  voiceStatus: (): Promise<{ available: boolean; reason: string }> => ipcRenderer.invoke(IPC.VOICE_STATUS),
  pickWorkspace: (): Promise<{ ok: boolean; path: string }> => ipcRenderer.invoke(IPC.WORKSPACE_PICK),
  avatarDataUrl: (): Promise<{ ok: boolean; dataUrl: string }> => ipcRenderer.invoke(IPC.ASSET_AVATAR),
  pickDocs: (): Promise<{ ok: boolean; copied: string[] }> => ipcRenderer.invoke(IPC.DOC_PICK),
  saveNote: (title: string, text: string): Promise<{ ok: boolean; path: string }> => ipcRenderer.invoke(IPC.NOTE_SAVE, { title, text }),
  addTask: (text: string): Promise<{ ok: boolean; path: string }> => ipcRenderer.invoke(IPC.TASK_ADD, text),
  exportChat: (history: { role: string; content: string }[]): Promise<{ ok: boolean; path: string }> =>
    ipcRenderer.invoke(IPC.CHAT_EXPORT, history),
  brainPing: (cfg: { url?: string; model?: string; key?: string }): Promise<{ ok: boolean; ms: number; answer: string }> =>
    ipcRenderer.invoke(IPC.BRAIN_PING, cfg),
  voiceTranscribe: (dataB64: string, mime: string): Promise<{ ok: boolean; text: string; error?: string }> =>
    ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, { dataB64, mime }),
  onCardia: (cb: (b: { cycle: number; lobe: 'A' | 'B'; lobeName: string }) => void): (() => void) => {
    const h = (_e: unknown, v: { cycle: number; lobe: 'A' | 'B'; lobeName: string }): void => cb(v)
    ipcRenderer.on(IPC.CARDIA_BEAT, h)
    return () => ipcRenderer.removeListener(IPC.CARDIA_BEAT, h)
  },
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
