// IPC channel names — never inline strings (house discipline).

export const IPC = {
  SESSION_RUN: 'session:run',
  SESSION_STEP: 'session:step',
  SESSION_FINAL: 'session:final',
  BRAINS_SCAN: 'brains:scan',
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_DECIDE: 'approval:decide',
  CHAT_SEND: 'chat:send',
  AUTO_SEND: 'auto:send',
  SESSION_STOP: 'session:stop',
  CHAT_STOP: 'chat:stop',
  BRAINS_SAVE: 'brains:save',
  BRAINS_LOAD: 'brains:load',
  SESSION_THINKING: 'session:thinking',
  CHAT_DELTA: 'chat:delta',
  CHAT_STATUS: 'chat:status'
} as const

export interface BrainConfig {
  kind: 'echo' | 'openai'
  url?: string
  model?: string
  key?: string
}

export type TrustMode = 'manual' | 'edits' | 'auto' | 'dry'

export interface SessionRequest {
  task: string
  brain: BrainConfig
  advisor?: BrainConfig
  trust: TrustMode
}
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequestPayload {
  history: ChatTurn[]
  brain: BrainConfig
  thinking: 'low' | 'mid' | 'high' | 'max'
  web: boolean
}

export interface AutoRequestPayload {
  history: ChatTurn[]
  brain: BrainConfig
  trust: TrustMode
  auto: boolean
}

export interface StoredBrain {
  url: string
  model: string
  keyEnc: string
  encrypted: boolean
}
