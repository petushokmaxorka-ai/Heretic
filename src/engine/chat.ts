// ═══════════════════════════════════════════════════════════
// Chat — the flagship surface: ask anything, get an answer.
// Optional web search (RAG-lite: results injected as context),
// thinking levels, streaming. No tools, no ledger — conversation.
// ═══════════════════════════════════════════════════════════

import type { Brain, ChatMessage } from '../protocol/types.js'
import type { ThinkingLevel } from '../thinking.js'
import { thinkingProfile } from '../thinking.js'
import { webSearch, type SearchResult } from '../tools/search.js'
import { trimMessages } from './ctx.js'
import { stripThink } from './strip-think.js'

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
  /** cooperative cancellation */
  signal?: AbortSignal
  /** user persona / custom instructions — appended to the system prompt */
  persona?: string
  /** image attachments (data URLs) for the latest user message */
  images?: string[]
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

  const history = opts.images?.length
    ? opts.history.map((m, i, arr) =>
        i === arr.length - 1 && m.role === 'user' ? { ...m, images: [...(m.images ?? []), ...opts.images!] } : m
      )
    : opts.history
  const system: ChatMessage = {
    role: 'system',
    content:
      'You are ANATHEMETRON, the resident organism of HERETIC. Answer helpfully, directly, in the user language. ' +
      thinking.directive +
      (opts.persona ? '\nUser persona / custom instructions:\n' + opts.persona : '') +
      contextBlock
  }

  const answer = stripThink(
    await opts.brain.chat(trimMessages([system, ...history]), {
    maxTokens: thinking.maxTokens,
    temperature: 0.4,
    onDelta: opts.onDelta,
    reasoningEffort: thinking.effort,
    signal: opts.signal
  })
  )

  return { answer, sources }
}

// ═══════════════════════════════════════════════════════════
// Council chat — several brains answer the same message,
// each reply labeled by model. Sequential, visible, honest.
// ═══════════════════════════════════════════════════════════

export interface CouncilChatReply {
  model: string
  answer: string
}

export async function runCouncilChat(
  opts: Omit<RunChatOptions, 'brain'> & { members: { brain: Brain; model: string }[] }
): Promise<{ replies: CouncilChatReply[]; sources: SearchResult[] }> {
  const { members, ...base } = opts
  const replies: CouncilChatReply[] = []
  let sources: SearchResult[] = []
  let first = true
  for (const m of members) {
    base.onStatus?.(`совет: ${m.model} думает…`)
    try {
      const r = await runChat({ ...base, brain: m.brain, web: first && base.web })
      replies.push({ model: m.model, answer: r.answer })
      if (first) sources = r.sources
    } catch (e) {
      replies.push({ model: m.model, answer: `✗ ${(e as Error).message}` })
    }
    first = false
  }
  base.onStatus?.(`совет: ${replies.length} ответ(ов)`)
  return { replies, sources }
}
