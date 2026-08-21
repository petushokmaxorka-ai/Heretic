// ═══════════════════════════════════════════════════════════
// llama.status — resident awareness, swap-safe by construction.
// GET /v1/models lists everything (never triggers a swap).
// GET /health (llama-swap) reports what is actually LOADED.
// We never POST/complete here — the footgun cannot fire from this file.
// ═══════════════════════════════════════════════════════════

import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

export interface LlamaStatus {
  models: { id: string; resident: boolean | null }[]
  source: string
}

const RESIDENT_WORDS = ['loaded', 'running', 'ready', 'active', 'up']
const ID_KEYS = new Set(['loaded', 'current', 'resident', 'model', 'running', 'active'])
const ARRAY_ID_KEYS = new Set(['loaded', 'models', 'running', 'residents', 'ready'])

/** Extract the set of loaded model ids from a /health payload, tolerantly. */
export function parseResidents(health: unknown, known: string[]): Set<string> | null {
  if (health === null || typeof health !== 'object') return null
  const found = new Set<string>()
  const accept = (candidate: string): void => {
    if (candidate && (known.length === 0 || known.includes(candidate)) && !RESIDENT_WORDS.includes(candidate.toLowerCase())) {
      found.add(candidate)
    }
  }
  const walk = (node: unknown, depth = 0): void => {
    if (depth > 4 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (known.length > 0 && known.includes(key) && RESIDENT_WORDS.some((w) => value.toLowerCase().includes(w))) {
          found.add(key) // state-map shape: {modelId: "loaded"}
        } else if (ID_KEYS.has(key)) {
          accept(value) // field shape: {current: "model-a"}
        }
      } else if (Array.isArray(value) && ARRAY_ID_KEYS.has(key)) {
        for (const item of value) if (typeof item === 'string') accept(item) // {loaded: ["a","b"]}
      } else {
        walk(value, depth + 1)
      }
    }
  }
  walk(health)
  return found.size > 0 ? found : null
}

export async function getResidents(baseUrl: string, known: string[] = [], timeoutMs = 1500): Promise<Set<string> | null> {
  try {
    const res = await fetch(new URL('health', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString(), {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    return parseResidents(await res.json(), known)
  } catch {
    return null
  }
}

export async function llamaStatus(baseUrl: string, timeoutMs = 2000): Promise<LlamaStatus> {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  const res = await fetch(new URL('v1/models', base).toString(), { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`llama.status: HTTP ${res.status} from ${baseUrl}`)
  const json = (await res.json()) as { data?: { id?: string }[] }
  const ids = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)
  const effective = await getResidents(base, ids)
  return {
    models: ids.map((id) => ({ id, resident: effective ? effective.has(id) : null })),
    source: effective ? `${base}health` : `${base}v1/models (health unavailable — residency unknown)`
  }
}

export const llamaStatusTool: Tool = {
  name: 'llama.status',
  description:
    'List models of a local runtime (default llama-swap) with residency marks: ◉ loaded in VRAM, ○ configured but not loaded, ? unknown. Read-only — never triggers a swap.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const raw = String(args.url ?? 'http://127.0.0.1:11436/')
    const guard = assertSafeUrl(raw)
    if (!guard.ok) return { ok: false, output: `llama.status: ${guard.message}` }
    try {
      const status = await llamaStatus(raw)
      if (!status.models.length) return { ok: true, output: '(no models configured)' }
      const lines = status.models.map((m) => `${m.resident === true ? '◉' : m.resident === false ? '○' : '?'} ${m.id}`)
      return { ok: true, output: `source: ${status.source}\n${lines.join('\n')}` }
    } catch (e) {
      return { ok: false, output: `llama.status failed: ${(e as Error).message}` }
    }
  }
}

/** Pick the default model preferring a resident — the CLI/desktop footgun fix. */
export function pickResident(models: string[], residents: Set<string> | null): { model: string; resident: boolean | null } {
  if (!models.length) return { model: 'default', resident: null }
  if (residents) {
    const hit = models.find((m) => residents.has(m))
    if (hit) return { model: hit, resident: true }
  }
  return { model: models[0]!, resident: null }
}
