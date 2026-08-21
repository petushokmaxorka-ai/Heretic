// plan.* — the agent's own task notebook (sandbox/plan.json).
// Long sessions stay coherent when the agent can write down and tick off
// its own steps. Own notebook, like vault — non-mutating by policy.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

interface PlanStep {
  text: string
  done: boolean
}

function planPath(ctx: ToolContext): string {
  return join(ctx.sandboxRoot, 'plan.json')
}

async function readPlan(ctx: ToolContext): Promise<PlanStep[]> {
  const raw = await readFile(planPath(ctx), 'utf-8').catch(() => '[]')
  try {
    const j = JSON.parse(raw) as { steps?: PlanStep[] }
    return Array.isArray(j.steps) ? j.steps : []
  } catch {
    return []
  }
}

async function writePlan(ctx: ToolContext, steps: PlanStep[]): Promise<void> {
  await mkdir(join(planPath(ctx), '..'), { recursive: true })
  await writeFile(planPath(ctx), JSON.stringify({ steps }, null, 2), 'utf-8')
}

export const planWrite: Tool = {
  name: 'plan.write',
  description:
    'Maintain your task plan. Either {steps: ["...", ...]} to (re)write the whole plan, or {mark_done: N} to tick off the N-th step (1-based).',
  mutating: false,
  async run(args, ctx): Promise<ToolResult> {
    try {
      if (Array.isArray(args.steps)) {
        const steps = (args.steps as unknown[]).map((s) => ({ text: String(s), done: false }))
        if (!steps.length) return { ok: false, output: 'plan.write: steps array is empty' }
        await writePlan(ctx, steps)
        return { ok: true, output: `plan written: ${steps.length} steps` }
      }
      if (typeof args.mark_done === 'number') {
        const n = args.mark_done
        const steps = await readPlan(ctx)
        if (n < 1 || n > steps.length) {
          return { ok: false, output: `plan.write: no step ${n} (plan has ${steps.length})` }
        }
        steps[n - 1]!.done = true
        await writePlan(ctx, steps)
        return { ok: true, output: `step ${n} marked done` }
      }
      return { ok: false, output: 'plan.write: pass {steps:[...]} or {mark_done:N}' }
    } catch (e) {
      return { ok: false, output: `plan.write failed: ${(e as Error).message}` }
    }
  }
}

export const planRead: Tool = {
  name: 'plan.read',
  description: 'Read the current task plan with done/pending markers.',
  mutating: false,
  async run(_args, ctx): Promise<ToolResult> {
    const steps = await readPlan(ctx)
    if (!steps.length) return { ok: true, output: '(no plan — write one with plan.write)' }
    return {
      ok: true,
      output: steps.map((s, i) => `${i + 1}. [${s.done ? '✓' : ' '}] ${s.text}`).join('\n')
    }
  }
}

export const planTools: Tool[] = [planWrite, planRead]
