// ═══════════════════════════════════════════════════════════
// Web search — keyless by default (DuckDuckGo lite HTML),
// SearXNG JSON when provided (Heretic-mode: :8888).
// ═══════════════════════════════════════════════════════════

import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Heretic/0.3'

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/** Parse DuckDuckGo lite HTML into results. Exported for hermetic tests. */
export function parseDdgLite(html: string, limit = 5): SearchResult[] {
  const out: SearchResult[] = []
  // attribute-order tolerant: match the whole anchor, then extract href from attrs
  const anchorRe = /<a\b([^>]*class=["']result-link["'][^>]*)>([\s\S]*?)<\/a>/g
  const snippetRe = /<td[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/g
  const links: { url: string; title: string }[] = []
  const snippets: string[] = []
  let m: RegExpExecArray | null
  while ((m = anchorRe.exec(html)) !== null) {
    const href = /href=["']([^"']+)["']/.exec(m[1]!)?.[1]
    if (href) links.push({ url: decodeEntities(href), title: stripTags(m[2]!) })
  }
  while ((m = snippetRe.exec(html)) !== null) snippets.push(stripTags(m[1]!))
  for (let i = 0; i < Math.min(links.length, limit); i++) {
    if (!links[i]!.title) continue
    out.push({ title: links[i]!.title, url: links[i]!.url, snippet: snippets[i] ?? '' })
  }
  return out
}

async function searxng(base: string, query: string, limit: number): Promise<SearchResult[]> {
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`searxng HTTP ${res.status}`)
  const json = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return (json.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, limit)
    .map((r) => ({ title: stripTags(r.title!), url: r.url!, snippet: stripTags(r.content ?? '') }))
}

async function ddg(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`ddg HTTP ${res.status}`)
  return parseDdgLite(await res.text(), limit)
}

export async function webSearch(query: string, opts?: { searxng?: string; limit?: number }): Promise<SearchResult[]> {
  const limit = opts?.limit ?? 5
  if (opts?.searxng) {
    try {
      return await searxng(opts.searxng, query, limit)
    } catch {
      // fall through to keyless ddg
    }
  }
  return ddg(query, limit)
}

export const webSearchTool: Tool = {
  name: 'web.search',
  description: 'Search the web (keyless). Returns titles, urls and snippets. Use for facts you are unsure about.',
  mutating: true, // network egress — passes the approval gate in manual mode
  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'web.search: args.query required' }
    const searxng = String(args.searxng ?? '') || undefined
    if (searxng) {
      const guard = assertSafeUrl(searxng)
      if (!guard.ok) return { ok: false, output: `web.search: ${guard.message}` }
    }
    try {
      const results = await webSearch(query, { searxng })
      if (!results.length) return { ok: true, output: '(no results)' }
      return {
        ok: true,
        output: results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')
      }
    } catch (e) {
      return { ok: false, output: `web.search failed: ${(e as Error).message}` }
    }
  }
}
