// fetch — light HTTP GET for reading pages/APIs without the browser pane.
// url-guard first, text-only, size-capped, timeout-bounded. Network egress
// → mutating → passes the approval gate (consistent with browser.open).

import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

const MAX_BYTES = 262_144
const TIMEOUT_MS = 15_000

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export const fetchTool: Tool = {
  name: 'fetch',
  description: 'HTTP GET a url (http/https only) as plain text. HTML is stripped to text. Up to 256KB. Lighter than browser.open — use for reading pages and APIs.',
  mutating: true,
  async run(args): Promise<ToolResult> {
    const url = String(args.url ?? '')
    const guard = assertSafeUrl(url)
    if (!guard.ok) return { ok: false, output: `fetch: ${guard.message}` }
    try {
      const res = await fetch(url.trim(), {
        headers: { 'User-Agent': 'Heretic/0.5 (+local agent)', Accept: 'text/html,text/plain,application/json,text/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow'
      })
      if (!res.ok) return { ok: false, output: `fetch: HTTP ${res.status}` }
      const type = (res.headers.get('content-type') ?? '').toLowerCase()
      if (type && !type.startsWith('text/') && !type.includes('json') && !type.includes('xml')) {
        return { ok: false, output: `fetch: unsupported content-type "${type}" (text only)` }
      }
      const buf = await res.arrayBuffer()
      const sliced = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
      let text = new TextDecoder('utf-8', { fatal: false }).decode(sliced)
      if (type.includes('html')) text = htmlToText(text)
      return { ok: true, output: text.slice(0, MAX_BYTES) || '(empty body)' }
    } catch (e) {
      return { ok: false, output: `fetch failed: ${(e as Error).message}` }
    }
  }
}
