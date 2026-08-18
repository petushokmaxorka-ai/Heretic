// ═══════════════════════════════════════════════════════════
// ANATHEMETRON — Agent loop (the engine core)
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

const TOOL_FENCE = /```tool\s*([\s\S]*?)```/

export interface AgentOptions {
  brain: Brain
  tools: Tool[]
  sandbox: Sandbox
  policy: ApprovalPolicy
  maxSteps?: number
  onStep?: (step: Step) => void
}

export interface AgentResult {
  ok: boolean
  final: string
  steps: Step[]
}

function systemPrompt(tools: Tool[], root: string): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
  return [
    'You are ANATHEMETRON, a supervised agent. You act ONLY through tools.',
    'Available tools:',
    list,
    '',
    'To call a tool, emit EXACTLY one fenced block per reply:',
    '```tool',
    '{"name":"fs.read","args":{"path":"notes.txt"}}',
    '```',
    `All paths are relative to the sandbox root "${root}". Escape attempts are rejected.`,
    'After the tools give you what you need, reply with plain text (no fence) as the final answer.'
  ].join('\n')
}

export async function runAgent(task: string, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 12
  const steps: Step[] = []
  let index = 0

  const emit = (step: Step): void => {
    steps.push(step)
    opts.onStep?.(step)
  }

  const ctx: ToolContext = { sandboxRoot: opts.sandbox.root }
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(opts.tools, opts.sandbox.root) },
    { role: 'user', content: task }
  ]

  for (let turn = 0; turn < maxSteps; turn++) {
    const reply = await opts.brain.chat(messages)
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
      const note = `malformed tool call: ${(e as Error).message}`
      messages.push({ role: 'tool', content: `ERROR ${note}` })
      emit({ index: ++index, kind: 'tool', title: '(malformed)', detail: fence[1]!.trim().slice(0, 120), verdict: 'rejected', note })
      continue
    }

    const name = String(call.name ?? '')
    const tool = opts.tools.find((t) => t.name === name)
    if (!tool) {
      const note = `unknown tool "${name}"`
      messages.push({ role: 'tool', content: `ERROR ${note}` })
      emit({ index: ++index, kind: 'tool', title: name || '(unnamed)', detail: JSON.stringify(call.args ?? {}), verdict: 'rejected', note })
      continue
    }

    if (tool.mutating) {
      const detail = JSON.stringify(call.args ?? {}).slice(0, 200)
      const allowed = await opts.policy.allow(name, detail)
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
