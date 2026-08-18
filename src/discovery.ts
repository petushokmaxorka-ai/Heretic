// Discovery — scan localhost for known OpenAI-compatible runtimes.
// Law #1 of the guest protocol: we never spawn a model server if one exists.

export interface RuntimeHit {
  name: string
  baseUrl: string
  models: string[]
}

export const KNOWN_RUNTIMES: { name: string; baseUrl: string }[] = [
  { name: 'llama-swap', baseUrl: 'http://127.0.0.1:11436/' },
  { name: 'ollama', baseUrl: 'http://127.0.0.1:11434/' },
  { name: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/' }
]

export async function probeUrl(name: string, baseUrl: string, timeoutMs = 1500): Promise<RuntimeHit | null> {
  try {
    const res = await fetch(new URL('v1/models', baseUrl).toString(), {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { id?: string }[] }
    const models = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)
    return { name, baseUrl, models }
  } catch {
    return null
  }
}

export async function discoverLocal(timeoutMs = 1500): Promise<RuntimeHit[]> {
  const hits = await Promise.all(KNOWN_RUNTIMES.map((r) => probeUrl(r.name, r.baseUrl, timeoutMs)))
  return hits.filter((h): h is RuntimeHit => h !== null)
}

// SearXNG autodetect (Heretic-mode: the noosphere engine behind :8888/:8080).
// Returns the first live JSON-capable base, null otherwise.
export async function discoverSearxng(timeoutMs = 1200): Promise<string | null> {
  const candidates = ['http://127.0.0.1:8888/', 'http://127.0.0.1:8080/']
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}search?q=test&format=json`, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return base
    } catch {
      // try next
    }
  }
  return null
}
