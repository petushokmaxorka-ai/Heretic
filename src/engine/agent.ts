// ═══════════════════════════════════════════════════════════
// ANATHEMETRON — Agent loop (the engine core of HERETIC)
// ═══════════════════════════════════════════════════════════
// Weak actor + strong critic: every tool call passes the
// verification ladder (path-safety → allowlist → approval),
// results feed back as tool messages, failures don't kill the loop.
//
// Tool protocol: any OpenAI-compatible brain may emit a fenced block
//   ```tool
//   {"name":"fs.write","args":{"path":"a.txt","content":"..."}}
//   ```
// Chosen over native function-calling so the smallest GGUF residents work.

import type {
  ApprovalPolicy,
  Brain,
  ChatMessage,
  Step,
  Tool,
  ToolContext
} from '../protocol/types.js'
import { Sandbox } from '../tools/sandbox.js'
import { previewFor } from './preview.js'
import { trimMessages } from './ctx.js'
import { stripThink } from './strip-think.js'

const TOOL_FENCE = /```tool\s*([\s\S]*?)```/

export interface AgentOptions {
  brain: Brain
  tools: Tool[]
  sandbox: Sandbox
  policy: ApprovalPolicy
  maxSteps?: number
  onStep?: (step: Step) => void
  /** ledger index offset — council prepends its own steps */
  startAt?: number
  /** cooperative cancellation */
  signal?: AbortSignal
  /** live thinking stream (brain deltas) for the ledger */
  onThinking?: (t: string) => void
  /** user persona / custom instructions */
  persona?: string
  /** persistent vault location (userData) — memory survives reboots */
  vaultRoot?: string
}

export interface AgentResult {
  ok: boolean
  final: string
  steps: Step[]
  aborted?: boolean
}

function systemPrompt(tools: Tool[], root: string, persona?: string): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
  return [
    'You are ANATHEMETRON, the resident organism of HERETIC — a supervised agent. You act ONLY through tools.',
    'Available tools:',
    list,
    '',
    'To call a tool, emit EXACTLY one fenced block per reply:',
    '```tool',
    '{"name":"fs.read","args":{"path":"notes.txt"}}',
    '```',
    `All paths are relative to the sandbox root "${root}". Escape attempts are rejected.`,
    ...(persona ? ['User persona / custom instructions:', persona] : []),
    'After the tools give you what you need, reply with plain text (no fence) as the final answer.',
    '',
    'Example — tool call, then final answer:',
    'user: what is in notes.txt?',
    'assistant:',
    '\u0060\u0060\u0060tool',
    '{"name":"fs.read","args":{"path":"notes.txt"}}',
    '\u0060\u0060\u0060',
    'tool output: the file contains: buy milk',
    'assistant: The file says: buy milk.',
    '',
    'Example — recovering from an error (wrong name -> list, then retry):',
    'assistant:',
    '\u0060\u0060\u0060tool',
    '{"name":"fs.read","args":{"path":"note.txt"}}',
    '\u0060\u0060\u0060',
    'tool output: ERROR fs.read failed: file not found: note.txt',
    'assistant:',
    '\u0060\u0060\u0060tool',
    '{"name":"fs.list","args":{}}',
    '\u0060\u0060\u0060',
    'tool output: notes.txt',
    'assistant: The file is named notes.txt; it says: buy milk.'
  ].join('\n')
}

export async function runAgent(task: string, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 12
  const steps: Step[] = []
  let index = opts.startAt ?? 0

  const emit = (step: Step): void => {
    steps.push(step)
    opts.onStep?.(step)
  }

  let malformedStreak = 0
  const ctx: ToolContext = { sandboxRoot: opts.sandbox.root, vaultRoot: opts.vaultRoot }
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(opts.tools, opts.sandbox.root, opts.persona) },
    { role: 'user', content: task }
  ]

  for (let turn = 0; turn < maxSteps; turn++) {
    if (opts.signal?.aborted) {
      emit({ index: ++index, kind: 'final', title: 'aborted', detail: 'stopped by user', verdict: 'rejected' })
      return { ok: false, final: '', steps, aborted: true }
    }
    let reply: string
    try {
      reply = stripThink(await opts.brain.chat(trimMessages(messages), {
        signal: opts.signal,
        onDelta: opts.onThinking
      }))
    } catch (e) {
      if (opts.signal?.aborted) {
        emit({ index: ++index, kind: 'final', title: 'aborted', detail: 'stopped by user', verdict: 'rejected' })
        return { ok: false, final: '', steps, aborted: true }
      }
      throw e
    }
    messages.push({ role: 'assistant', content: reply })

    const fence = reply.match(TOOL_FENCE)
    if (!fence) {
      emit({ index: ++index, kind: 'final', title: 'final answer', detail: reply.trim(), verdict: 'verified' })
      return { ok: true, final: reply.trim(), steps }
    }

    let call: { name?: string; args?: Record<string, unknown> }
    try {
      call = JSON.parse(fence[1]!.trim()) as typeof call
    } catch (e) {
      malformedStreak++
      const note = malformedStreak >= 2 ? 'protocol violations — giving up' : 'malformed JSON — repair requested'
      messages.push({
        role: 'tool',
        content:
          `ERROR: that tool call was NOT valid JSON (${(e as Error).message}). ` +
          'Reply again with EXACTLY one fenced block in this shape:\n' +
          '\u0060\u0060\u0060tool\n{"name":"<tool-name>","args":{<arguments>}}\n\u0060\u0060\u0060'
      })
      emit({ index: ++index, kind: 'tool', title: '(malformed)', detail: fence[1]!.trim().slice(0, 120), verdict: 'rejected', note })
      if (malformedStreak >= 2) {
        emit({ index: ++index, kind: 'final', title: 'stopped', detail: 'repeated protocol violations', verdict: 'rejected' })
        return { ok: false, final: '', steps }
      }
      continue
    }
    malformedStreak = 0

    const name = String(call.name ?? '')
    const tool = opts.tools.find((t) => t.name === name)
    if (!tool) {
      const note = `unknown tool "${name}" — available: ${opts.tools.map((t) => t.name).join(', ')}`
      messages.push({ role: 'tool', content: `ERROR ${note}. Reply with a corrected tool call.` })
      emit({ index: ++index, kind: 'tool', title: name || '(unnamed)', detail: JSON.stringify(call.args ?? {}), verdict: 'rejected', note })
      continue
    }

    if (tool.mutating) {
      const detail = JSON.stringify(call.args ?? {}).slice(0, 200)
      const diff = await previewFor(name, call.args ?? {}, opts.sandbox.root)
      const allowed = await opts.policy.allow(name, detail, diff)
      if (!allowed) {
        const note = 'denied by approval policy (HITL)'
        messages.push({ role: 'tool', content: 'ERROR denied by policy' })
        emit({ index: ++index, kind: 'tool', title: name, detail, verdict: 'rejected', note })
        continue
      }
    }

    let result
    try {
      result = await tool.run(call.args ?? {}, ctx)
    } catch (e) {
      result = { ok: false, output: `tool crashed: ${(e as Error).message}` }
    }

    messages.push({ role: 'tool', content: result.ok ? result.output : `ERROR ${result.output}` })
    emit({
      index: ++index,
      kind: 'tool',
      title: name,
      detail: result.output.split('\n')[0]?.slice(0, 120) ?? '',
      verdict: result.ok ? 'verified' : 'rejected',
      note: result.ok ? undefined : 'rolled back / not applied'
    })
  }

  emit({ index: ++index, kind: 'final', title: 'stopped', detail: 'max steps reached without a final answer', verdict: 'rejected' })
  return { ok: false, final: '', steps }
}
