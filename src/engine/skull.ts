// ═══════════════════════════════════════════════════════════
// SKULL-lite — immune layer over tools
// ═══════════════════════════════════════════════════════════
// Wraps any Tool with: destructive-pattern blacklist (checked before
// execution), a per-session mutation cap, and an append-only audit
// trail. Inspired by heretic-os SKULL L1–L6; deliberately minimal.

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

// Patterns apply to the raw args JSON of MUTATING tools only.
// Keep the list short and commented — each entry must earn its place.
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /rm\s+-rf?\s+[~/]/i, why: 'recursive force delete at root' },
  { pattern: /mkfs(\.|\s)/i, why: 'filesystem formatting' },
  { pattern: /dd\s+if=/i, why: 'raw disk write' },
  { pattern: /:\(\)\s*\{.*\};:/s, why: 'fork bomb' },
  { pattern: /curl[^|]*\|\s*(ba)?sh/, why: 'remote code execution pipe' },
  { pattern: /wget[^|]*\|\s*(ba)?sh/, why: 'remote code execution pipe' },
  { pattern: /\/etc\/(passwd|shadow)/i, why: 'credential file access' },
  { pattern: /chmod\s+-R?\s*777/i, why: 'world-writable permission bomb' }
]

const DEFAULT_MUTATION_CAP = 25

export interface SkullOptions {
  mutationCap?: number
  auditFile?: (sandboxRoot: string) => string
}

export function skullGuard(tool: Tool, opts: SkullOptions = {}): Tool {
  const cap = opts.mutationCap ?? DEFAULT_MUTATION_CAP
  const auditFile =
    opts.auditFile ?? ((root: string) => join(root, 'skull-audit.jsonl'))
  let mutations = 0

  return {
    ...tool,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const raw = JSON.stringify(args)

      if (tool.mutating) {
        for (const f of FORBIDDEN) {
          if (f.pattern.test(raw)) {
            await audit(ctx, tool.name, raw, `SKULL: rejected — ${f.why}`)
            return { ok: false, output: `SKULL: rejected — ${f.why}` }
          }
        }
        if (mutations >= cap) {
          await audit(ctx, tool.name, raw, `SKULL: mutation cap reached (${cap})`)
          return { ok: false, output: `SKULL: mutation cap reached (${cap}) — session quarantined` }
        }
        mutations++
      }

      const result = await tool.run(args, ctx)
      await audit(ctx, tool.name, raw, result.ok ? 'ok' : `tool-failed: ${result.output.slice(0, 80)}`)
      return result
    }
  }

  async function audit(ctx: ToolContext, name: string, args: string, verdict: string): Promise<void> {
    try {
      const file = auditFile(ctx.sandboxRoot)
      await mkdir(join(file, '..'), { recursive: true })
      await appendFile(
        file,
        JSON.stringify({ t: new Date().toISOString(), tool: name, args: args.slice(0, 200), verdict }) + '\n',
        'utf-8'
      )
    } catch {
      // the immune system must never kill the patient
    }
  }
}

export function skullGuardAll(tools: Tool[], opts: SkullOptions = {}): Tool[] {
  return tools.map((t) => skullGuard(t, opts))
}
