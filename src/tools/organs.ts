// Heretic-mode organs: memoria.query (Qdrant-backed Memoria :8766) and
// services.health (dashboard :7777). Best-effort with graceful degradation —
// on a stranger's machine they answer "unavailable", never crash the agent.

import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

const TIMEOUT = 6000

function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : base + '/'
}

function extractText(items: unknown[]): string[] {
  const out: string[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item)
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const text = (o.text ?? o.content ?? o.payload ?? o.document ?? o.page_content) as unknown
      if (typeof text === 'string') out.push(text)
      else if (text && typeof text === 'object') {
        const inner = (text as Record<string, unknown>).text
        if (typeof inner === 'string') out.push(inner)
      }
    }
  }
  return out
}

export const memoriaQuery: Tool = {
  name: 'memory.semantic',
  description:
    'Semantic search in the host Memoria (Qdrant-backed, :8766 by default). Deeper than memory.recall. Heretic-mode organ — degrades gracefully when absent.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'memory.semantic: args.query required' }
    const base = normalizeBase(String(args.base ?? 'http://127.0.0.1:8766/'))
    const guard = assertSafeUrl(base)
    if (!guard.ok) return { ok: false, output: `memory.semantic: ${guard.message}` }
    try {
      let res = await fetch(new URL('search', base).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5 }),
        signal: AbortSignal.timeout(TIMEOUT)
      })
      if (!res.ok) {
        res = await fetch(new URL(`search?q=${encodeURIComponent(query)}&limit=5`, base).toString(), {
          signal: AbortSignal.timeout(TIMEOUT)
        })
      }
      if (!res.ok) {
        return { ok: false, output: `memory.semantic: memoria unavailable (HTTP ${res.status}) — use memory.recall instead` }
      }
      const json = (await res.json()) as { results?: unknown[]; items?: unknown[]; hits?: unknown[] }
      const items = json.results ?? json.items ?? json.hits ?? []
      const texts = extractText(items as unknown[])
      if (!texts.length) return { ok: true, output: '(memoria: nothing relevant)' }
      return { ok: true, output: texts.map((t, i) => `[${i + 1}] ${t.slice(0, 400)}`).join('\n') }
    } catch {
      return { ok: false, output: 'memory.semantic: memoria unreachable (Heretic-mode organ) — use memory.recall instead' }
    }
  }
}

export const servicesHealth: Tool = {
  name: 'services.health',
  description:
    'Health of the host service fleet via the dashboard API (:7777 by default). Returns ✓ active / ✗ dead per service. Heretic-mode organ — degrades gracefully.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const base = normalizeBase(String(args.base ?? 'http://127.0.0.1:7777/'))
    const guard = assertSafeUrl(base)
    if (!guard.ok) return { ok: false, output: `services.health: ${guard.message}` }
    try {
      const res = await fetch(new URL('api/health/services', base).toString(), {
        signal: AbortSignal.timeout(TIMEOUT)
      })
      if (!res.ok) {
        return { ok: false, output: `services.health: dashboard unavailable (HTTP ${res.status})` }
      }
      const json = (await res.json()) as { services?: { name?: string; status?: string; active?: boolean }[] }
      const list = json.services ?? []
      if (!list.length) return { ok: true, output: '(no services reported)' }
      const lines = list.map((s) => `${s.active ?? s.status === 'active' ? '✓' : '✗'} ${s.name ?? '?'} ${s.status ?? ''}`)
      return { ok: true, output: lines.join('\n') }
    } catch {
      return { ok: false, output: 'services.health: dashboard unreachable (Heretic-mode organ)' }
    }
  }
}
