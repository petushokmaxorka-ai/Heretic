// ═══════════════════════════════════════════════════════════
// HERETIC — Protocol types (ANATHEMETRON engine) (single source of truth)
// ═══════════════════════════════════════════════════════════

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
  /** stream tokens as they arrive (brains that can, will) */
  onDelta?: (t: string) => void
  /** reasoning-effort hint: low/medium/high/max — honored by backends that support it */
  reasoningEffort?: string
}

/** A brain is any OpenAI-compatible chat endpoint (local runtime or cloud API). */
export interface Brain {
  id: string
  label: string
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>
}

export type Verdict = 'verified' | 'awaiting' | 'rejected'

export type StepKind = 'tool' | 'final'

/** One line of the Step Ledger — the product's primary UI primitive. */
export interface Step {
  index: number
  kind: StepKind
  title: string
  detail: string
  verdict: Verdict
  note?: string
}

export interface ToolResult {
  ok: boolean
  output: string
}

export interface ToolContext {
  sandboxRoot: string
}

export interface Tool {
  name: string
  description: string
  /** mutating tools pass through the ApprovalPolicy before running */
  mutating: boolean
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export interface ApprovalPolicy {
  allow(action: string, detail: string): Promise<boolean>
}
