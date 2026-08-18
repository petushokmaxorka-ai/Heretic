// IPC channel names — never inline strings (house discipline).

export const IPC = {
  SESSION_RUN: 'session:run',
  SESSION_STEP: 'session:step',
  SESSION_FINAL: 'session:final',
  BRAINS_SCAN: 'brains:scan',
  APPROVAL_REQUEST: 'approval:request',
  APPROVAL_DECIDE: 'approval:decide'
} as const

export interface BrainConfig {
  kind: 'echo' | 'openai'
  url?: string
  model?: string
  key?: string
}

export type TrustMode = 'manual' | 'auto' | 'dry'
