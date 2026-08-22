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
  PERSONA_SAVE: 'persona:save',
  PERSONA_LOAD: 'persona:load',
  ATTACH_PICK: 'attach:pick',
  VOICE_STATUS: 'voice:status',
  VOICE_TRANSCRIBE: 'voice:transcribe',
  CARDIA_BEAT: 'cardia:beat',
  WORKSPACE_PICK: 'workspace:pick',
  ASSET_AVATAR: 'asset:avatar',
  DOC_PICK: 'doc:pick',
  NOTE_SAVE: 'note:save',
  TASK_ADD: 'task:add',
  CHAT_EXPORT: 'chat:export',
  BRAIN_PING: 'brain:ping',
  MCP_SAVE: 'mcp:save',
  ASK_USER: 'ask:user',
  ASK_ANSWER: 'ask:answer',
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
  persona?: string
  images?: string[]
  codexUrl?: string
  codexModel?: string
  councilModels?: string[]
}

export interface StoredBrain {
  url: string
  model: string
  keyEnc: string
  encrypted: boolean
  /** Codex Imperium brain: agent sessions prefer it when set */
  codexUrl?: string
  codexModel?: string
}
