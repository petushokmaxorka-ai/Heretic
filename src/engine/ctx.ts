// Context management — honest trimming so long sessions don't blow the
// model's context window with a raw API error. Char-based heuristic
// (~4 chars per token for RU/EN mix), images counted flat.

import type { ChatMessage } from '../protocol/types.js'

export const IMAGE_TOKEN_COST = 1000
const DEFAULT_BUDGET_CHARS = 28_000 // ~7k tokens of history, safe for ctx 8192

export function estimateTokens(messages: ChatMessage[]): number {
  let tokens = 0
  for (const m of messages) {
    tokens += Math.ceil((m.content?.length ?? 0) / 4)
    tokens += (m.images?.length ?? 0) * IMAGE_TOKEN_COST
  }
  return tokens
}

/**
 * Keep the system message(s) + the newest tail within the char budget.
 * Oldest non-system messages are dropped first; if a single message is
 * bigger than the whole budget it is middle-truncated with an honest marker.
 */
export function trimMessages(messages: ChatMessage[], budgetChars = DEFAULT_BUDGET_CHARS): ChatMessage[] {
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')

  const systemChars = system.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  let budget = Math.max(2000, budgetChars - systemChars)

  const kept: ChatMessage[] = []
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i]!
    const size = (m.content?.length ?? 0) + (m.images?.length ?? 0) * (IMAGE_TOKEN_COST * 4)
    if (size > budget && kept.length === 0 && i === rest.length - 1) {
      // the newest message alone exceeds the budget — middle-truncate it
      const half = Math.floor(budget / 2)
      const text = m.content ?? ''
      kept.push({
        ...m,
        images: m.images?.slice(0, 1),
        content:
          text.slice(0, half) +
          `\n\n[…context truncated: message was ${text.length} chars, budget ${budget}…]\n\n` +
          text.slice(-half)
      })
      budget = 0
      break
    }
    if (size > budget) break
    kept.unshift(m)
    budget -= size
  }

  if (kept.length < rest.length && kept.length > 0) {
    // honest marker where history was cut
    kept[0] = {
      ...kept[0]!,
      content: `[…earlier history trimmed to fit the context window…]\n\n${kept[0]!.content}`
    }
  }
  return [...system, ...kept]
}
