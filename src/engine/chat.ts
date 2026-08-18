// ═══════════════════════════════════════════════════════════
// Chat — the flagship surface: ask anything, get an answer.
// Optional web search (RAG-lite: results injected as context),
// thinking levels, streaming. No tools, no ledger — conversation.
// ═══════════════════════════════════════════════════════════

import type { Brain, ChatMessage } from '../protocol/types.js'
import type { ThinkingLevel } from '../thinking.js'
import { thinkingProfile } from '../thinking.js'
import { webSearch, type SearchResult } from '../tools/search.js'

export interface RunChatOptions {
  /** full conversation INCLUDING the latest user message */
  history: ChatMessage[]
  brain: Brain
  thinking?: ThinkingLevel
  web?: boolean
  searxng?: string
  /** injectable for hermetic tests */
  searchFn?: (q: string, opts?: { searxng?: string }) => Promise<SearchResult[]>
  onDelta?: (t: string) => void
  onStatus?: (line: string) => void
}

export interface ChatResult {
  answer: string
  sources: SearchResult[]
}

export async function runChat(opts: RunChatOptions): Promise<ChatResult> {
  const thinking = thinkingProfile(opts.thinking ?? 'mid')
  const lastUser = [...opts.history].reverse().find((m) => m.role === 'user')?.content ?? ''

  let sources: SearchResult[] = []
  if (opts.web && lastUser) {
    opts.onStatus?.('searching the web…')
    try {
      sources = await (opts.searchFn ?? webSearch)(lastUser, { searxng: opts.searxng })
      opts.onStatus?.(`web: ${sources.length} results`)
    } catch (e) {
      opts.onStatus?.(`web search failed: ${(e as Error).message}`)
    }
  }

  const contextBlock = sources.length
    ? '\n\nWeb search results (cite as [n]):\n' +
      sources.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
    : ''

  const system: ChatMessage = {
    role: 'system',
    content:
      'You are ANATHEMETRON, the resident organism of HERETIC. Answer helpfully, directly, in the user language. ' +
      thinking.directive +
      contextBlock
  }

  const answer = await opts.brain.chat([system, ...opts.history], {
    maxTokens: thinking.maxTokens,
    temperature: 0.4,
    onDelta: opts.onDelta,
    reasoningEffort: thinking.effort
  })

  return { answer, sources }
}
