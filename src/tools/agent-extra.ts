// ask.user + agent.subtask — Claude Code AskUserQuestion/Task parity.

import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'
import { runAgent, type AgentOptions } from '../engine/agent.js'

export const askUser: Tool = {
  name: 'ask.user',
  description:
    'Ask the human (Principal) a question and wait for the answer: {question, options?: ["yes","no",...]}. Use when info is missing or a choice matters.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const question = String(args.question ?? '').trim()
    if (!question) return { ok: false, output: 'ask.user: args.question required' }
    if (!ctx.ask) return { ok: false, output: 'ask.user: no interactive surface in this session' }
    const options = Array.isArray(args.options) ? (args.options as unknown[]).map(String).slice(0, 5) : undefined
    const answer = await ctx.ask(question, options)
    return { ok: true, output: answer || '(no answer)' }
  }
}

/** Nested agent: same brain, isolated subfolder, subtools (no recursion). */
export function makeSubtaskTool(baseOptions: AgentOptions): Tool {
  return {
    name: 'agent.subtask',
    description:
      'Spawn a nested agent for a self-contained subtask: {task, max_steps? (<=6)}. It runs in .sub/<id> with the same brain; returns its final answer.',
    mutating: true,
    async run(args, ctx: ToolContext): Promise<ToolResult> {
      const task = String(args.task ?? '').trim()
      if (!task) return { ok: false, output: 'agent.subtask: args.task required' }
      const maxSteps = Math.max(1, Math.min(6, Number(args.max_steps ?? 4) || 4))
      const subRoot = join(ctx.sandboxRoot, '.sub', `task-${Date.now().toString(36)}`)
      const sandbox = new Sandbox(subRoot)
      const subTools = baseOptions.tools.filter((t: Tool) => t.name !== 'agent.subtask')
      const result = await runAgent(task, {
        brain: baseOptions.brain,
        tools: subTools,
        sandbox,
        policy: baseOptions.policy,
        maxSteps,
        persona: baseOptions.persona,
        vaultRoot: baseOptions.vaultRoot,
        signal: baseOptions.signal
      })
      return {
        ok: result.ok,
        output: result.ok
          ? `[subtask: ${result.steps.filter((st: { kind: string }) => st.kind === 'tool').length} steps]\n${result.final}`
          : `[subtask failed]\n${result.final || 'no answer'}`
      }
    }
  }
}
