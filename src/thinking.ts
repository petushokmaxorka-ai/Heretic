// Thinking levels — the flagship knob: low / mid / high / max.
// Maps to: token budget + reasoning_effort hint (backends that support it
// honor it, others ignore the extra field harmlessly) + a prompt directive
// that carries the weight on small local residents.

export type ThinkingLevel = 'low' | 'mid' | 'high' | 'max'

interface ThinkingProfile {
  maxTokens: number
  effort: string
  directive: string
}

const MAP: Record<ThinkingLevel, ThinkingProfile> = {
  low: { maxTokens: 512, effort: 'low', directive: 'Answer directly. Minimal deliberation.' },
  mid: { maxTokens: 1024, effort: 'medium', directive: 'Think briefly, then answer.' },
  high: { maxTokens: 2048, effort: 'high', directive: 'Think step by step before answering.' },
  max: { maxTokens: 4096, effort: 'max', directive: 'Think as long as needed. Explore multiple angles before answering.' }
}

export function thinkingProfile(level: ThinkingLevel): ThinkingProfile {
  return MAP[level] ?? MAP.mid
}

export function isThinkingLevel(v: string): v is ThinkingLevel {
  return v === 'low' || v === 'mid' || v === 'high' || v === 'max'
}
