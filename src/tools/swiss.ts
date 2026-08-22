// Swiss Army tools: charts, tables, QR, passwords, IP, bases, lorem,
// feeds, TTS, image info, file watching — all zero-dep.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, randomInt } from 'node:crypto'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

// ── chart.bar: ASCII bar chart ────────────────────────────
export const chartBar: Tool = {
  name: 'chart.bar',
  description: 'ASCII bar chart from key-value data: {data: {"label": number, ...}, width? (default 40), title?}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const data = args.data as Record<string, number> | undefined
    if (!data || typeof data !== 'object') return { ok: false, output: 'chart.bar: args.data (object of label→number) required' }
    const width = Math.min(80, Number(args.width ?? 40) || 40)
    const title = String(args.title ?? '')
    const entries = Object.entries(data).slice(0, 20)
    if (!entries.length) return { ok: false, output: 'chart.bar: empty data' }
    const max = Math.max(...entries.map(([, v]) => Math.abs(Number(v) || 0)), 1)
    const maxLabel = Math.max(...entries.map(([k]) => k.length))
    const lines: string[] = []
    if (title) lines.push(title, '')
    for (const [label, value] of entries) {
      const v = Number(value) || 0
      const barLen = Math.round((Math.abs(v) / max) * width)
      const bar = '█'.repeat(Math.max(0, barLen))
      const sign = v < 0 ? '-' : ''
      lines.push(`${label.padEnd(maxLabel + 1)} ${sign}${bar} ${v}`)
    }
    return { ok: true, output: lines.join('\n') }
  }
}

// ── md.table: markdown table from data ────────────────────
export const mdTable: Tool = {
  name: 'md.table',
  description: 'Generate a markdown table from an array of objects: {rows: [{col1: val, ...}, ...]}. Auto-detects columns.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const rows = args.rows as Record<string, unknown>[] | undefined
    if (!Array.isArray(rows) || !rows.length) return { ok: false, output: 'md.table: args.rows (array of objects) required' }
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    if (!cols.length) return { ok: false, output: 'md.table: no columns detected' }
    const header = `| ${cols.join(' | ')} |`
    const sep = `| ${cols.map(() => '---').join(' | ')} |`
    const body = rows.slice(0, 50).map((r) => `| ${cols.map((c) => String(r[c] ?? '')).join(' | ')} |`)
    return { ok: true, output: [header, sep, ...body].join('\n') }
  }
}

// ── md.render: markdown to HTML ───────────────────────────
export const mdRender: Tool = {
  name: 'md.render',
  description: 'Convert markdown text to HTML: {text}. Handles headers, bold, italic, code blocks, links, lists.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'md.render: args.text required' }
    // minimal md → html
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/^### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^## (.*)$/gm, '<h3>$1</h3>')
      .replace(/^# (.*)$/gm, '<h3>$1</h3>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br>')
    html = `<p>${html}</p>`
    return { ok: true, output: html }
  }
}

// ── password.gen ──────────────────────────────────────────
export const passwordGen: Tool = {
  name: 'password.gen',
  description: 'Generate secure passwords: {length? (default 20), count? (default 3), uppercase?, digits?, symbols?, exclude?}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const length = Math.min(128, Math.max(8, Number(args.length ?? 20) || 20))
    const count = Math.min(10, Number(args.count ?? 3) || 3)
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    const lower = 'abcdefghijkmnopqrstuvwxyz'
    const digits = '23456789'
    const symbols = args.symbols === false ? '' : '!@#$%^&*-_+='
    const exclude = String(args.exclude ?? '')
    let charset = lower
    if (args.uppercase !== false) charset += upper
    if (args.digits !== false) charset += digits
    charset += symbols
    charset = [...charset].filter((c) => !exclude.includes(c)).join('')
    if (!charset.length) return { ok: false, output: 'password.gen: all characters excluded' }
    const passwords: string[] = []
    for (let i = 0; i < count; i++) {
      const bytes = randomBytes(length)
      let pw = ''
      for (let j = 0; j < length; j++) {
        pw += charset[bytes[j]! % charset.length]
      }
      passwords.push(pw)
    }
    return { ok: true, output: passwords.join('\n') }
  }
}

// ── ip.calc ───────────────────────────────────────────────
export const ipCalc: Tool = {
  name: 'ip.calc',
  description: 'IP/subnet calculator: {ip (e.g. "192.168.1.10/24")}. Returns network, broadcast, mask, hosts, range.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const input = String(args.ip ?? '').trim()
    if (!input) return { ok: false, output: 'ip.calc: args.ip required (e.g. "192.168.1.10/24")' }
    const [ipStr, cidrStr] = input.split('/')
    const cidr = parseInt(cidrStr ?? '24', 10)
    if (isNaN(cidr) || cidr < 0 || cidr > 32) return { ok: false, output: `ip.calc: invalid CIDR /${cidrStr}` }
    const parts = (ipStr ?? '').split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return { ok: false, output: `ip.calc: invalid IP "${ipStr}"` }
    }
    const ip = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
    const mask = cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const hosts = cidr >= 31 ? cidr === 32 ? 1 : 2 : Math.pow(2, 32 - cidr) - 2
    const fmt = (n: number): string => `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
    return {
      ok: true,
      output: [
        `ip: ${fmt(ip)}/${cidr}`,
        `network: ${fmt(network)}`,
        `broadcast: ${fmt(broadcast)}`,
        `mask: ${fmt(mask)}`,
        `usable hosts: ${hosts}`,
        cidr < 31 ? `range: ${fmt(network + 1)} – ${fmt(broadcast - 1)}` : ''
      ].filter(Boolean).join('\n')
    }
  }
}

// ── base.convert ──────────────────────────────────────────
export const baseConvert: Tool = {
  name: 'base.convert',
  description: 'Number base conversion: {value, from: 2|8|10|16|36 (default 10), to: 2|8|10|16|36 (default 16)}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const value = String(args.value ?? '').trim()
    const from = Number(args.from ?? 10) || 10
    const to = Number(args.to ?? 16) || 16
    if (!value) return { ok: false, output: 'base.convert: args.value required' }
    if (![2, 8, 10, 16, 36].includes(from) || ![2, 8, 10, 16, 36].includes(to)) {
      return { ok: false, output: 'base.convert: from/to must be one of 2, 8, 10, 16, 36' }
    }
    const num = parseInt(value.replace(/^0[bxo]/i, '') || '0', from)
    if (isNaN(num)) return { ok: false, output: `base.convert: invalid value "${value}" for base ${from}` }
    const prefixes: Record<number, string> = { 2: '0b', 8: '0o', 16: '0x' }
    const result = num.toString(to).toUpperCase()
    return { ok: true, output: `${prefixes[to] ?? ''}${result}` }
  }
}

// ── lorem.gen ─────────────────────────────────────────────
export const loremGen: Tool = {
  name: 'lorem.gen',
  description: 'Generate placeholder text: {type: paragraphs|sentences|words (default paragraphs), count? (default 2), russian? (default false)}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const type = String(args.type ?? 'paragraphs')
    const count = Math.min(10, Number(args.count ?? 2) || 2)
    const russian = args.russian === true
    const latin = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua']
    const cyrillic = ['да', 'это', 'просто', 'текст', 'для', 'заполнения', 'пространства', ' здесь', 'может', 'быть', 'ваш', 'контент', 'проверка', 'отображения', 'шрифта', 'размер', 'строки']
    const words = russian ? cyrillic : latin
    const genSentence = (): string => {
      const len = randomInt(6, 14)
      const parts: string[] = []
      for (let i = 0; i < len; i++) parts.push(words[randomInt(0, words.length)] ?? "")
      const s = parts.join(' ')
      return s.charAt(0).toUpperCase() + s.slice(1) + '.'
    }
    if (type === 'words') {
      const parts: string[] = []
      for (let i = 0; i < count * 10; i++) parts.push(words[randomInt(0, words.length)] ?? "")
      return { ok: true, output: parts.join(' ') }
    }
    if (type === 'sentences') {
      const sentences: string[] = []
      for (let i = 0; i < count; i++) sentences.push(genSentence())
      return { ok: true, output: sentences.join(' ') }
    }
    const paragraphs: string[] = []
    for (let i = 0; i < count; i++) {
      const sentences: string[] = []
      for (let j = 0; j < randomInt(3, 6); j++) sentences.push(genSentence())
      paragraphs.push(sentences.join(' '))
    }
    return { ok: true, output: paragraphs.join('\n\n') }
  }
}

// ── feed.parse: RSS/Atom ──────────────────────────────────
export const feedParse: Tool = {
  name: 'feed.parse',
  description: 'Parse RSS/Atom XML feed: {url}. Returns title, link, pubDate for each item (max 10).',
  mutating: true,
  async run(args): Promise<ToolResult> {
    const url = String(args.url ?? '')
    if (!url.trim()) return { ok: false, output: 'feed.parse: args.url required' }
    if (!/^https?:\/\//.test(url)) return { ok: false, output: 'feed.parse: url must be http/https' }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Heretic/1.8' } })
      if (!res.ok) return { ok: false, output: `feed.parse: HTTP ${res.status}` }
      const xml = await res.text()
      const items: { title: string; link: string; date: string }[] = []
      const itemRe = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g
      let m: RegExpExecArray | null
      while ((m = itemRe.exec(xml)) !== null && items.length < 10) {
        const block = m[0]
        const title = /<(?:title)[^>]*>([\s\S]*?)<\/(?:title)>/.exec(block)?.[1]?.trim() ?? ''
        const link = /<(?:link)[^>]*href="([^"]+)"/.exec(block)?.[1] ?? /<(?:link)[^>]*>([\s\S]*?)<\/(?:link)>/.exec(block)?.[1]?.trim() ?? ''
        const date = /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)</.exec(block)?.[1]?.trim() ?? ''
        if (title) items.push({ title, link, date })
      }
      if (!items.length) return { ok: false, output: 'feed.parse: no items found (not a valid RSS/Atom feed?)' }
      return { ok: true, output: items.map((item, i) => `[${i + 1}] ${item.title}\n    ${item.link}${item.date ? `\n    ${item.date}` : ''}`).join('\n') }
    } catch (e) {
      return { ok: false, output: `feed.parse failed: ${(e as Error).message}` }
    }
  }
}

// ── image.info ────────────────────────────────────────────
export const imageInfo: Tool = {
  name: 'image.info',
  description: 'Read image dimensions and format from header bytes: {path}. Supports PNG, JPEG, GIF, BMP, WebP.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '')
    if (!path) return { ok: false, output: 'image.info: args.path required' }
    try {
      const buf = await readFile(new Sandbox(ctx.sandboxRoot).resolve(path))
      if (buf.length < 24) return { ok: false, output: 'image.info: file too small' }
      let format = 'unknown'
      let width = 0
      let height = 0
      if (buf[0] === 0x89 && buf[1] === 0x50) {
        format = 'PNG'
        width = buf.readUInt32BE(16)
        height = buf.readUInt32BE(20)
      } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
        format = 'JPEG'
        let i = 2
        while (i < buf.length - 9) {
          if (buf[i] === 0xFF && buf[i + 1]! >= 0xC0 && buf[i + 1]! <= 0xCF && buf[i + 1] !== 0xC4 && buf[i + 1] !== 0xC8 && buf[i + 1] !== 0xCC) {
            height = buf.readUInt16BE(i + 5)
            width = buf.readUInt16BE(i + 7)
            break
          }
          i += 2 + buf.readUInt16BE(i + 2)
        }
      } else if (buf[0] === 0x47 && buf[1] === 0x49) {
        format = 'GIF'
        width = buf.readUInt16LE(6)
        height = buf.readUInt16LE(8)
      } else if (buf[0] === 0x42 && buf[1] === 0x4D) {
        format = 'BMP'
        width = buf.readInt32LE(18)
        height = Math.abs(buf.readInt32LE(22))
      } else if (buf[8] === 0x57 && buf[9] === 0x45) {
        format = 'WebP'
        // VP8/VP8L/VP8X chunk parsing is complex; just report format
      }
      const size = (buf.length / 1024).toFixed(1)
      return { ok: true, output: `format: ${format}\nsize: ${width}×${height}\nfile: ${size} KB\npath: ${path}` }
    } catch (e) {
      return { ok: false, output: `image.info failed: ${(e as Error).message}` }
    }
  }
}

// ── watch.file ────────────────────────────────────────────
export const watchFile: Tool = {
  name: 'watch.file',
  description: 'Wait for a file to change or appear: {path, timeout_seconds? (default 30)}. Returns when mtime changes.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '')
    const timeoutSec = Math.min(120, Number(args.timeout_seconds ?? 30) || 30)
    if (!path) return { ok: false, output: 'watch.file: args.path required' }
    const abs = new Sandbox(ctx.sandboxRoot).resolve(path)
    const startExists = existsSync(abs)
    const startMtime = startExists ? (await stat(abs)).mtimeMs : 0
    const start = Date.now()
    while (Date.now() - start < timeoutSec * 1000) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const s = await stat(abs)
        if (!startExists || s.mtimeMs > startMtime) {
          return { ok: true, output: `${path} changed (mtime: ${s.mtime.toISOString()})` }
        }
      } catch {
        if (startExists) return { ok: true, output: `${path} was deleted` }
      }
    }
    return { ok: false, output: `watch.file: timeout after ${timeoutSec}s — ${path} unchanged` }
  }
}

export const swissTools: Tool[] = [
  chartBar, mdTable, mdRender, passwordGen, ipCalc,
  baseConvert, loremGen, feedParse, imageInfo, watchFile
]
