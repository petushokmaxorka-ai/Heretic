// Info tools: SearXNG advanced, weather (wttr.in, keyless), Wikipedia search.

import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

const TIMEOUT = 10_000

export const searxAdvanced: Tool = {
  name: 'searx.query',
  description:
    'SearXNG advanced search: {query, categories?: general|images|videos|news|it|science, language?: ru|en, time_range?: day|week|month|year, base? (default :8888)}. Heretic-mode organ.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'searx.query: args.query required' }
    const base = String(args.base ?? 'http://127.0.0.1:8888/').replace(/\/$/, '')
    const guard = assertSafeUrl(base + '/')
    if (!guard.ok) return { ok: false, output: `searx.query: ${guard.message}` }
    const params = new URLSearchParams({ q: query, format: 'json' })
    const categories = String(args.categories ?? '')
    const language = String(args.language ?? '')
    const time_range = String(args.time_range ?? '')
    if (categories) params.set('categories', categories)
    if (language) params.set('language', language)
    if (time_range) params.set('time_range', time_range)
    try {
      const res = await fetch(`${base}/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT) })
      if (!res.ok) return { ok: false, output: `searx.query: HTTP ${res.status}` }
      const json = (await res.json()) as {
        results?: { title?: string; url?: string; content?: string; publishedDate?: string }[]
        answers?: string[]
      }
      const answers = json.answers ?? []
      const results = (json.results ?? []).slice(0, 8)
      if (!results.length && !answers.length) return { ok: true, output: '(no results)' }
      const parts: string[] = []
      if (answers.length) parts.push('Answers:', ...answers.map((a) => `  ${a}`))
      if (results.length) {
        parts.push('Results:')
        results.forEach((r, i) => parts.push(`[${i + 1}] ${r.title ?? '?'}\n    ${r.url ?? ''}\n    ${(r.content ?? '').slice(0, 150)}${r.publishedDate ? ` (${r.publishedDate})` : ''}`))
      }
      return { ok: true, output: parts.join('\n') }
    } catch (e) {
      return { ok: false, output: `searx.query failed (SearXNG unavailable?): ${(e as Error).message}` }
    }
  }
}

export const weatherGet: Tool = {
  name: 'weather.get',
  description: 'Current weather via wttr.in (keyless): {location (e.g. "Moscow", "55.75,37.61"), format?: json|text (default json)}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const location = String(args.location ?? '').trim()
    if (!location) return { ok: false, output: 'weather.get: args.location required' }
    try {
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`
      const res = await fetch(url, { headers: { 'User-Agent': 'curl' }, signal: AbortSignal.timeout(TIMEOUT) })
      if (!res.ok) return { ok: false, output: `weather.get: HTTP ${res.status}` }
      const j = (await res.json()) as {
        current_condition?: { temp_C?: string; FeelsLikeC?: string; humidity?: string; windspeedKmph?: string; weatherDesc?: { value: string }[]; }[]
        nearest_area?: { areaName?: { value: string }[]; country?: { value: string }[] }[]
      }
      const cur = j.current_condition?.[0]
      const area = j.nearest_area?.[0]
      if (!cur) return { ok: false, output: '(no weather data)' }
      return {
        ok: true,
        output: [
          `location: ${area?.areaName?.[0]?.value ?? location}, ${area?.country?.[0]?.value ?? ''}`.trim(),
          `temp: ${cur.temp_C ?? '?'}°C (feels ${cur.FeelsLikeC ?? '?'})`,
          `condition: ${cur.weatherDesc?.[0]?.value ?? '?'}`,
          `humidity: ${cur.humidity ?? '?'}%`,
          `wind: ${cur.windspeedKmph ?? '?'} km/h`
        ].join('\n')
      }
    } catch (e) {
      return { ok: false, output: `weather.get failed: ${(e as Error).message}` }
    }
  }
}

export const wikiSearch: Tool = {
  name: 'wiki.search',
  description: 'Wikipedia search (keyless): {query, language: ru|en (default ru), limit? (default 5)}. Returns titles + snippets.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'wiki.search: args.query required' }
    const lang = ['ru', 'en', 'de', 'fr'].includes(String(args.language)) ? String(args.language) : 'ru'
    const limit = Math.min(10, Number(args.limit ?? 5) || 5)
    try {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: String(limit),
        format: 'json',
        origin: '*'
      })
      const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'Heretic/1.6' },
        signal: AbortSignal.timeout(TIMEOUT)
      })
      if (!res.ok) return { ok: false, output: `wiki.search: HTTP ${res.status}` }
      const j = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } }
      const results = j.query?.search ?? []
      if (!results.length) return { ok: true, output: '(no results)' }
      return {
        ok: true,
        output: results.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.snippet.replace(/<[^>]+>/g, '').slice(0, 200)}`).join('\n')
      }
    } catch (e) {
      return { ok: false, output: `wiki.search failed: ${(e as Error).message}` }
    }
  }
}

export const infoTools: Tool[] = [searxAdvanced, weatherGet, wikiSearch]
