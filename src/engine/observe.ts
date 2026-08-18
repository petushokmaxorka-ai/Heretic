// ═══════════════════════════════════════════════════════════
// OBSERVE — intent router (homage to the void-shield observatory:
// it watches the nodes and picks the best; this one watches the
// request and picks the surface). Transparent: every verdict
// carries its reasons into the log. No silent magic.
// ═══════════════════════════════════════════════════════════

import type { Brain } from '../protocol/types.js'
import { isThinkingLevel, type ThinkingLevel } from '../thinking.js'

export interface Verdict {
  mode: 'chat' | 'agent'
  web: boolean
  thinking: ThinkingLevel
  reasons: string[]
}

// ── Fast layer: deterministic heuristics (RU/EN), zero cost ──

const AGENT_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /(?<![\p{L}\p{N}_])(создай|сделай|запиши|открой|исправь|удали|переименуй|запусти|проверь\s+файл|наведи\s+порядок)/iu, why: 'imperative verb' },
  { re: /\b(create|write|open|fix|delete|rename|run|make|build|clean up)\b.*\b(file|folder|directory|config|script)\b/i, why: 'file action' },
  { re: /(?<![\p{L}\p{N}_])(файл|папк[аиеу]|директори[\p{L}]*)/iu, why: 'filesystem mention' },
  { re: /(^|\s)(\/|~\/|\.{0,2}\/)[\w.-]+|\b[\w-]+\.(txt|md|py|ts|js|json|ya?ml|toml|sh|html|css)\b/i, why: 'path/file token' },
  { re: /(?<![\p{L}\p{N}_])((в\s+)?песочниц[\p{L}]*|sandbox)/iu, why: 'sandbox mention' }
]

const WEB_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /(?<![\p{L}\p{N}_])(сегодня|сейчас|недавн[\p{L}]*|новост[\p{L}]*|последн[\p{L}]*|цена|курс|погод[\p{L}]*|кто\s+выиграл|расписание)/iu, why: 'fresh facts' },
  { re: /\b(today|now|latest|news|price|weather|schedule|recent)\b/i, why: 'fresh facts' },
  { re: /(?<![\p{L}\p{N}_])(найди|поищи)\s+(в\s+)?(интернете|сети|веб[\p{L}]*)|\bsearch\s+(the\s+)?web\b/iu, why: 'explicit web ask' },
  { re: /https?:\/\//i, why: 'link present' }
]

const DEEP_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /(?<![\p{L}\p{N}_])(почему|объясни|докажи|сравни|проанализируй|выведи|рассуди|плюсы\s+и\s+минусы)/iu, why: 'reasoning verb' },
  { re: /\b(why|explain|prove|compare|analyze|reason|trade-?offs?)\b/i, why: 'reasoning verb' },
  { re: /(?<![\p{L}\p{N}_])(шаг\s+за\s+шагом|подробно|глубоко|детально)|\b(step\s+by\s+step|in\s+depth|detailed)\b/iu, why: 'depth requested' },
  { re: /[0-9]\s*[+\-*/^]\s*[0-9]|(?<![\p{L}\p{N}_])уравнени[\p{L}]*|(?<![\p{L}\p{N}_])доказательств[\p{L}]*/iu, why: 'math' }
]

export function observe(message: string): Verdict {
  const reasons: string[] = []

  let mode: 'chat' | 'agent' = 'chat'
  for (const p of AGENT_PATTERNS) {
    if (p.re.test(message)) {
      mode = 'agent'
      reasons.push(p.why)
    }
  }

  let web = false
  for (const p of WEB_PATTERNS) {
    if (p.re.test(message)) {
      web = true
      reasons.push(p.why)
    }
  }

  let deep = 0
  for (const p of DEEP_PATTERNS) {
    if (p.re.test(message)) deep++
  }
  if (message.length > 400) {
    deep++
    reasons.push('long message')
  }

  let thinking: ThinkingLevel = 'mid'
  if (deep >= 2) thinking = 'max'
  else if (deep === 1) thinking = 'high'
  if (deep > 0) reasons.push(`depth=${deep}`)
  if (mode === 'agent') reasons.unshift('task-like')
  else reasons.unshift('question-like')

  return { mode, web, thinking, reasons }
}

// ── Smart layer: tiny classifier call to a brain (optional) ──
// The resident answers with strict JSON; one repair round; on any
// failure we fall back to the fast layer — the observer never blocks.

const ROUTER_PROMPT =
  'Classify the user request. Reply with ONLY this JSON, no prose:\n' +
  '{"mode":"chat|agent","web":true|false,"thinking":"low|mid|high|max"}\n' +
  'mode=agent when the request asks to create/modify files or run commands; chat otherwise. ' +
  'web=true when fresh internet facts are needed. thinking matches complexity.'

export async function observeSmart(message: string, brain: Brain): Promise<Verdict> {
  const fallback = observe(message)
  let raw = ''
  try {
    raw = await brain.chat(
      [
        { role: 'system', content: ROUTER_PROMPT },
        { role: 'user', content: message.slice(0, 1000) }
      ],
      { maxTokens: 120, temperature: 0 }
    )
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no json')
    const j = JSON.parse(m[0]) as { mode?: string; web?: boolean; thinking?: string }
    return {
      mode: j.mode === 'agent' ? 'agent' : 'chat',
      web: Boolean(j.web),
      thinking: isThinkingLevel(String(j.thinking)) ? (j.thinking as ThinkingLevel) : fallback.thinking,
      reasons: [`smart:${brain.id}`]
    }
  } catch {
    return { ...fallback, reasons: [...fallback.reasons, 'smart-parse-failed'] }
  }
}
