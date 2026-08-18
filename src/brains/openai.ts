// OpenAI-compatible brain: works with llama-swap, Ollama, LM Studio,
// llama.cpp server and cloud APIs (Kimi, GLM, MiniMax, OpenAI...).
// One interface, zero runtime dependencies (node fetch).

import type { Brain, ChatMessage, ChatOptions } from '../protocol/types.js'

function endpoint(baseUrl: string): string {
  return new URL('v1/chat/completions', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString()
}

export class OpenAIBrain implements Brain {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string
  ) {}

  async chat(messages: ChatMessage[], opts?: ChatOptions & { onDelta?: (t: string) => void; reasoningEffort?: string }): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const stream = Boolean(opts?.onDelta)
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: opts?.maxTokens ?? 1024,
      temperature: opts?.temperature ?? 0.3,
      stream
    }
    // Backends that support reasoning control honor it; others ignore the field.
    if (opts?.reasoningEffort) body.reasoning_effort = opts.reasoningEffort

    const res = await fetch(endpoint(this.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000)
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`brain "${this.id}" HTTP ${res.status}: ${text.slice(0, 300)}`)
    }

    if (!stream || !res.body) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      return json.choices?.[0]?.message?.content ?? ''
    }

    // SSE stream: data: {"choices":[{"delta":{"content":"…"}}]} … data: [DONE]
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const delta = j.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            opts?.onDelta?.(delta)
          }
        } catch {
          // skip keep-alive / partial frames
        }
      }
    }
    return full
  }
}
