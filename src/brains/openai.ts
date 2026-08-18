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

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const res = await fetch(endpoint(this.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.3,
        stream: false
      }),
      signal: AbortSignal.timeout(120_000)
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`brain "${this.id}" HTTP ${res.status}: ${body.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return json.choices?.[0]?.message?.content ?? ''
  }
}
