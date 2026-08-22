// Specialist tools: CSV, XML, HTML, SQL, templates, units, geo,
// HTTP mock, checksums, snippets, unicode, wrap — zero-dep.

import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

// ── CSV parse / format ────────────────────────────────────
export const csvParse: Tool = {
  name: 'csv.parse',
  description: 'Parse CSV text to JSON: {text, delimiter? (default ","), header? (default true)}. Returns array of objects.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'csv.parse: args.text required' }
    const delim = String(args.delimiter ?? ',')
    const hasHeader = args.header !== false
    const lines = text.trim().split('\n')
    const headers = hasHeader ? lines[0]!.split(delim).map((h) => h.trim()) : lines[0]!.split(delim).map((_, i) => `col${i}`)
    const rows = hasHeader ? lines.slice(1) : lines
    const result = rows.slice(0, 200).map((line) => {
      const cells = line.split(delim).map((c) => c.trim())
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => {
        obj[h] = cells[i] ?? ''
      })
      return obj
    })
    return { ok: true, output: JSON.stringify(result, null, 2) }
  }
}

export const csvFormat: Tool = {
  name: 'csv.format',
  description: 'Format JSON array of objects to CSV: {rows, delimiter? (default ",")}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const rows = args.rows as Record<string, unknown>[] | undefined
    if (!Array.isArray(rows) || !rows.length) return { ok: false, output: 'csv.format: args.rows (array of objects) required' }
    const delim = String(args.delimiter ?? ',')
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    const header = cols.join(delim)
    const body = rows.slice(0, 200).map((r) => cols.map((c) => String(r[c] ?? '')).join(delim))
    return { ok: true, output: [header, ...body].join('\n') }
  }
}

// ── XML parse (basic) ─────────────────────────────────────
export const xmlParse: Tool = {
  name: 'xml.parse',
  description: 'Parse basic XML to JSON: {text}. Handles single-level elements with text content and attributes.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'xml.parse: args.text required' }
    const result: Record<string, unknown> = {}
    const tagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(text)) !== null) {
      const tag = m[1] ?? ''
      const content = m[3] ?? ''
      const value = content.trim()
      if (/^<\w+/.test(value)) {
        // nested — recurse one level
        const nested: Record<string, unknown> = {}
        const nestedRe = /<(\w+)[^>]*>([\s\S]*?)<\/\1>/g
        let nm: RegExpExecArray | null
        while ((nm = nestedRe.exec(value)) !== null) {
          nested[nm[1]!] = nm[2]!.trim()
        }
        result[tag!] = nested
      } else if (/^\d+(\.\d+)?$/.test(value)) {
        result[tag!] = Number(value)
      } else if (value === 'true' || value === 'false') {
        result[tag!] = value === 'true'
      } else {
        result[tag!] = value
      }
    }
    if (!Object.keys(result).length) return { ok: false, output: 'xml.parse: no parseable elements found' }
    return { ok: true, output: JSON.stringify(result, null, 2) }
  }
}

// ── HTML extract ──────────────────────────────────────────
export const htmlExtract: Tool = {
  name: 'html.extract',
  description: 'Extract data from HTML: {html, what: text|links|images|meta}. Returns structured extraction.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const html = String(args.html ?? '')
    const what = String(args.what ?? 'text')
    if (!html.trim()) return { ok: false, output: 'html.extract: args.html required' }
    if (what === 'links') {
      const links: { text: string; href: string }[] = []
      const re = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null && links.length < 50) {
        links.push({ href: m[1] ?? '', text: (m[2] ?? '').replace(/<[^>]+>/g, '').trim() })
      }
      return { ok: true, output: links.map((l, i) => `[${i + 1}] ${l.text || '(no text)'}\n    ${l.href}`).join('\n') || '(no links)' }
    }
    if (what === 'images') {
      const imgs: string[] = []
      const re = /<img[^>]*src="([^"]*)"/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null && imgs.length < 50) imgs.push(m[1]!)
      return { ok: true, output: imgs.join('\n') || '(no images)' }
    }
    if (what === 'meta') {
      const metas: Record<string, string> = {}
      const re = /<meta[^>]*(?:name|property)="([^"]*)"[^>]*content="([^"]*)"/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(html)) !== null) metas[m[1]!] = m[2]!
      const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? ''
      if (title) metas.title = title
      return { ok: true, output: Object.entries(metas).map(([k, v]) => `${k}: ${v}`).join('\n') || '(no meta)' }
    }
    // text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
    return { ok: true, output: text.slice(0, 4000) || '(empty)' }
  }
}

// ── SQL format ────────────────────────────────────────────
export const sqlFormat: Tool = {
  name: 'sql.format',
  description: 'Pretty-print SQL: {text}. Keywords uppercase, clauses on new lines, indentation.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const sql = String(args.text ?? '')
    if (!sql.trim()) return { ok: false, output: 'sql.format: args.text required' }
    const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'UNION', 'UNION ALL', 'WITH', 'RETURNING']
    let formatted = sql.trim()
    for (const kw of keywords) {
      formatted = formatted.replace(new RegExp(String.raw`\b${kw}\b`, 'gi'), kw)
    }
    formatted = formatted
      .replace(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|VALUES|SET|UNION|WITH)\b/g, '\n$1')
      .replace(/\b(JOIN|LEFT JOIN|RIGHT JOIN)\b/g, '\n  $1')
      .replace(/\b(AND|OR)\b/g, '\n  $1')
      .replace(/,(\s*(?!\n))/g, ',\n  ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return { ok: true, output: formatted }
  }
}

// ── Template render ───────────────────────────────────────
export const templateRender: Tool = {
  name: 'template.render',
  description: 'Render a template with {{variables}}: {template, vars: {key: value}}. Supports {{key}} and {{key|default}}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const template = String(args.template ?? '')
    const vars = (args.vars as Record<string, string>) ?? {}
    if (!template) return { ok: false, output: 'template.render: args.template required' }
    const rendered = template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_m, key: string, def: string | undefined) => {
      return vars[key] ?? def ?? ''
    })
    const missing = [...template.matchAll(/\{\{(\w+)(?!\|)/g)].map((m) => m[1] ?? '').filter((k) => k && !vars[k])
    return {
      ok: true,
      output: rendered + (missing.length ? `\n[unresolved: ${missing.join(', ')}]` : '')
    }
  }
}

// ── Unit convert ──────────────────────────────────────────
const UNITS: Record<string, Record<string, number>> = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, yd: 0.9144, nmi: 1852 },
  mass: { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.453592, oz: 0.0283495, st: 6.35029 },
  data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }
}

export const unitConvert: Tool = {
  name: 'unit.convert',
  description: 'Convert units: {value, from, to, category: length|mass|data|temperature}. E.g. {value: 5, from: km, to: mi}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const value = Number(args.value)
    const from = String(args.from ?? '').toLowerCase()
    const to = String(args.to ?? '').toLowerCase()
    const category = String(args.category ?? '')
    if (!Number.isFinite(value)) return { ok: false, output: 'unit.convert: args.value (number) required' }
    if (!from || !to) return { ok: false, output: 'unit.convert: args.from and args.to required' }
    if (category === 'temperature' || from.match(/^[cfk]$/) || to.match(/^[cfk]$/) || from.includes('cels') || from.includes('fahr')) {
      let celsius: number
      if (from.startsWith('c') || from.includes('cels')) celsius = value
      else if (from.startsWith('f') || from.includes('fahr')) celsius = (value - 32) * 5 / 9
      else if (from.startsWith('k')) celsius = value - 273.15
      else return { ok: false, output: `unit.convert: unknown temperature unit "${from}"` }
      let result: number
      if (to.startsWith('c') || to.includes('cels')) result = celsius
      else if (to.startsWith('f') || to.includes('fahr')) result = celsius * 9 / 5 + 32
      else if (to.startsWith('k')) result = celsius + 273.15
      else return { ok: false, output: `unit.convert: unknown temperature unit "${to}"` }
      return { ok: true, output: `${value}°${from.toUpperCase()} = ${result.toFixed(2)}°${to.toUpperCase()}` }
    }
    for (const [cat, table] of Object.entries(UNITS)) {
      if (table[from] !== undefined && table[to] !== undefined) {
        const result = (value * table[from]!) / table[to]!
        return { ok: true, output: `${value} ${from} = ${result.toFixed(4).replace(/\.?0+$/, '')} ${to}` }
      }
    }
    return { ok: false, output: `unit.convert: can't convert ${from} → ${to}. Categories: length (m/km/mi/ft/in/yd/nmi), mass (kg/g/lb/oz/st), data (B/KB/MB/GB/TB), temperature (C/F/K)` }
  }
}

// ── Geo distance ──────────────────────────────────────────
export const geoDistance: Tool = {
  name: 'geo.distance',
  description: 'Haversine distance between coordinates: {from: {lat, lon}, to: {lat, lon}, unit: km|mi|nm (default km)}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const from = args.from as { lat: number; lon: number } | undefined
    const to = args.to as { lat: number; lon: number } | undefined
    if (!from || !to) return { ok: false, output: 'geo.distance: args.from and args.to ({lat, lon}) required' }
    const R = 6371 // Earth radius km
    const dLat = ((to.lat - from.lat) * Math.PI) / 180
    const dLon = ((to.lon - from.lon) * Math.PI) / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const unit = String(args.unit ?? 'km')
    const val = unit === 'mi' ? km * 0.621371 : unit === 'nm' ? km * 0.539957 : km
    return { ok: true, output: `${val.toFixed(1)} ${unit}` }
  }
}

// ── HTTP mock server ──────────────────────────────────────
let mockServer: Server | null = null
let mockPort = 0

export const httpMock: Tool = {
  name: 'http.mock',
  description: 'Start a temporary HTTP mock server: {response: {status?, body?, headers?}, port? (random)}. Returns the URL. Stop with action: "stop".',
  mutating: true,
  async run(args): Promise<ToolResult> {
    if (String(args.action ?? '') === 'stop') {
      mockServer?.close()
      mockServer = null
      return { ok: true, output: 'mock server stopped' }
    }
    const response = (args.response as { status?: number; body?: string }) ?? {}
    if (mockServer) {
      return { ok: true, output: `mock server already running on :${mockPort}` }
    }
    mockServer = createServer((_req, res) => {
      res.writeHead(response.status ?? 200, { 'Content-Type': 'application/json' })
      res.end(response.body ?? '{"mock": true}')
    })
    await new Promise<void>((r) => { mockServer?.listen(Number(args.port ?? 0), '127.0.0.1', () => r()) })
    mockPort = (mockServer.address() as { port: number }).port
    return { ok: true, output: `mock server: http://127.0.0.1:${mockPort}` }
  }
}

// ── Checksum verify ───────────────────────────────────────
export const checksumVerify: Tool = {
  name: 'checksum.verify',
  description: 'Verify files against a checksums string: {checksums: "hash  filename\\n..."}. Files relative to sandbox.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const checksums = String(args.checksums ?? '')
    if (!checksums.trim()) return { ok: false, output: 'checksum.verify: args.checksums required' }
    const sandbox = new Sandbox(ctx.sandboxRoot)
    const lines = checksums.trim().split('\n')
    const results: string[] = []
    let allOk = true
    for (const line of lines.slice(0, 20)) {
      const [expected, filename] = line.trim().split(/\s+/)
      if (!expected || !filename) continue
      try {
        const buf = await readFile(sandbox.resolve(filename))
        const algo = expected.length === 64 ? 'sha256' : expected.length === 40 ? 'sha1' : expected.length === 32 ? 'md5' : 'sha256'
        const actual = createHash(algo).update(buf).digest('hex')
        const ok = actual === expected.toLowerCase()
        if (!ok) allOk = false
        results.push(`${ok ? '✓' : '✗'} ${filename}${ok ? '' : `\n  expected: ${expected}\n  actual:   ${actual}`}`)
      } catch {
        allOk = false
        results.push(`✗ ${filename} (not found)`)
      }
    }
    return { ok: allOk, output: results.join('\n') || '(no valid checksum lines)' }
  }
}

// ── Code snippets ─────────────────────────────────────────
export const snippetSave: Tool = {
  name: 'snippet.save',
  description: 'Save a code snippet for reuse: {name, language, code}. Stored in vault/snippets/.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const name = String(args.name ?? '')
    const language = String(args.language ?? 'text')
    const code = String(args.code ?? '')
    if (!name || !code) return { ok: false, output: 'snippet.save: args.name and args.code required' }
    const dir = join(ctx.vaultRoot ?? ctx.sandboxRoot, 'vault', 'snippets')
    await mkdir(dir, { recursive: true })
    const filename = `${name.replace(/[^\w-]/g, '_')}.${language}`
    await writeFile(join(dir, filename), code, 'utf-8')
    return { ok: true, output: `saved: vault/snippets/${filename}` }
  }
}

export const snippetSearch: Tool = {
  name: 'snippet.search',
  description: 'Search saved snippets: {query? (matches name and content), language?}. Lists matches with preview.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const dir = join(ctx.vaultRoot ?? ctx.sandboxRoot, 'vault', 'snippets')
    const query = String(args.query ?? '').toLowerCase()
    const language = String(args.language ?? '')
    try {
      const files = await readdir(dir)
      const results: string[] = []
      for (const f of files.slice(0, 20)) {
        if (language && !f.endsWith(`.${language}`)) continue
        const content = await readFile(join(dir, f), 'utf-8').catch(() => '')
        if (query && !f.toLowerCase().includes(query) && !content.toLowerCase().includes(query)) continue
        results.push(`◆ ${f}\n  ${content.slice(0, 150).replace(/\n/g, '\n  ')}`)
      }
      return { ok: true, output: results.join('\n\n') || '(no snippets found)' }
    } catch {
      return { ok: true, output: '(no snippets saved yet)' }
    }
  }
}

// ── Text wrap ─────────────────────────────────────────────
export const textWrap: Tool = {
  name: 'text.wrap',
  description: 'Wrap text at a column width: {text, width? (default 80)}. Preserves paragraphs.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    const width = Math.min(200, Math.max(20, Number(args.width ?? 80) || 80))
    if (!text.trim()) return { ok: false, output: 'text.wrap: args.text required' }
    const paragraphs = text.split('\n\n')
    const wrapped = paragraphs.map((para) => {
      const words = para.split(/\s+/)
      const lines: string[] = []
      let current = ''
      for (const word of words) {
        if ((current + ' ' + word).trim().length > width) {
          if (current) lines.push(current.trim())
          current = word
        } else {
          current += ' ' + word
        }
      }
      if (current.trim()) lines.push(current.trim())
      return lines.join('\n')
    })
    return { ok: true, output: wrapped.join('\n\n') }
  }
}

export const specialistTools: Tool[] = [
  csvParse, csvFormat, xmlParse, htmlExtract, sqlFormat,
  templateRender, unitConvert, geoDistance, httpMock,
  checksumVerify, snippetSave, snippetSearch, textWrap
]
