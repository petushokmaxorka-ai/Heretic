// ═══════════════════════════════════════════════════════════
// ANATHEMETRON — Council (the visual differentiator)
// ═══════════════════════════════════════════════════════════
// Advisors debate the task in parallel; the synthesizer brain then
// EXECUTES with the debate as context: "cloud plans, local executes".
// Council steps land in the same ledger before the agent's own steps.

import type { AgentOptions, AgentResult } from './agent.js'
import { runAgent } from './agent.js'
import type { Brain, Step } from '../protocol/types.js'

export interface CouncilOptions extends AgentOptions {
  /** the synthesizer is opts.brain; advisors answer first, in parallel */
  advisors: { brain: Brain; role: string }[]
}

export async function runCouncil(task: string, opts: CouncilOptions): Promise<AgentResult> {
  const { advisors, ...agentOpts } = opts
  const councilSteps: Step[] = []
  let index = 0
  const emit = (step: Step): void => {
    councilSteps.push(step)
    opts.onStep?.(step)
  }

  const replies: { role: string; answer: string }[] = []
  const results = await Promise.allSettled(
    advisors.map(async ({ brain, role }) => {
      const answer = await brain.chat([
        { role: 'system', content: `You are the "${role}" advisor in a council. Answer concisely (max 200 words). You advise; another member executes.` },
        { role: 'user', content: task }
      ], { maxTokens: 512, temperature: 0.4 })
      return { role, answer }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      replies.push(r.value)
      emit({
        index: ++index,
        kind: 'tool',
        title: `council:${r.value.role}`,
        detail: r.value.answer.replace(/\s+/g, ' ').slice(0, 140),
        verdict: 'verified'
      })
    } else {
      emit({
        index: ++index,
        kind: 'tool',
        title: 'council:advisor',
        detail: String(r.reason).slice(0, 140),
        verdict: 'rejected',
        note: 'advisor unreachable'
      })
    }
  }

  const debate = replies.length
    ? '\n\nCouncil advice:\n' + replies.map((r) => `[${r.role}] ${r.answer}`).join('\n\n')
    : ''

  const result = await runAgent(task + debate, {
    ...agentOpts,
    startAt: index
  })

  return { ...result, steps: [...councilSteps, ...result.steps] }
}
