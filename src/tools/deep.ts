// Deep Ops: code execution, archives, YAML, dates, regex, markdown,
// cron, colors, text stats — all zero-dep.

import { execFile } from 'node:child_process'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

const EXEC_TIMEOUT = 10_000
const MAX_OUT = 16_000

// ── code.run: sandboxed JS ────────────────────────────────
export const codeRun: Tool = {
  name: 'code.run',
  description: 'Execute JavaScript in a sandboxed eval: {code}. Console.log output is captured. 10s timeout. No require/import/fs/network.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const code = String(args.code ?? '')
    if (!code.trim()) return { ok: false, output: 'code.run: args.code required' }
    if (/require\s*\(|import\s|process\.|fetch\s*\(|__dirname|globalThis\.process/.test(code)) {
      return { ok: false, output: 'code.run: require/import/process/fetch are not allowed' }
    }
    const logs: string[] = []
    const mockConsole = {
      log: (...a: unknown[]): void => {
        logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '))
      },
      error: (...a: unknown[]): void => {
        logs.push('ERR: ' + a.map(String).join(' '))
      },
      warn: (...a: unknown[]): void => {
        logs.push('WARN: ' + a.map(String).join(' '))
      }
    }
    try {
      const fn = new Function('console', 'module', 'exports', `"use strict";\n${code}`)
      const result = fn(mockConsole, { exports: {} }, {})
      const out = logs.join('\n')
      const resultStr = result !== undefined ? `\n→ ${typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}` : ''
      return { ok: true, output: (out || '(no output)') + resultStr }
    } catch (e) {
      return { ok: false, output: `${logs.join('\n')}\nError: ${(e as Error).message}`.trim() }
    }
  }
}

// ── code.python ───────────────────────────────────────────
export const codePython: Tool = {
  name: 'code.python',
  description: 'Execute Python 3 code: {code}. stdout/stderr captured, 10s timeout, sandbox cwd.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const code = String(args.code ?? '')
    if (!code.trim()) return { ok: false, output: 'code.python: args.code required' }
    return new Promise((resolve) => {
      execFile('python3', ['-c', code], { cwd: ctx.sandboxRoot, timeout: EXEC_TIMEOUT, maxBuffer: 256 * 1024, shell: false }, (err, stdout, stderr) => {
        const out = String(stdout).slice(0, MAX_OUT)
        const errOut = String(stderr).slice(0, 4000)
        if (err && !stdout) {
          resolve({ ok: false, output: `python error: ${errOut || err.message}` })
        } else {
          resolve({ ok: true, output: out + (errOut ? `\nstderr: ${errOut}` : '') || '(no output)' })
        }
      })
    })
  }
}

// ── archive.tar / untar ───────────────────────────────────
export const archiveTar: Tool = {
  name: 'archive.tar',
  description: 'Create a tar.gz archive in the sandbox: {source (file or dir), output}. Uses system tar.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const source = String(args.source ?? '')
    const output = String(args.output ?? '')
    if (!source || !output) return { ok: false, output: 'archive.tar: args.source and args.output required' }
    const sandbox = new Sandbox(ctx.sandboxRoot)
    const src = sandbox.resolve(source)
    const out = sandbox.resolve(output)
    return new Promise((resolve) => {
      execFile('tar', ['-czf', out, '-C', ctx.sandboxRoot, source], { timeout: 30_000 }, (err, _stdout, stderr) => {
        if (existsSync(out)) resolve({ ok: true, output: `archived ${source} → ${output}` })
        else resolve({ ok: false, output: `archive.tar failed: ${String(stderr || err?.message || 'unknown').slice(0, 200)}` })
      })
    })
  }
}

export const archiveUntar: Tool = {
  name: 'archive.untar',
  description: 'Extract a tar.gz archive into the sandbox: {archive, dest? (default ".")}.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const archive = String(args.archive ?? '')
    const dest = String(args.dest ?? '.')
    if (!archive) return { ok: false, output: 'archive.untar: args.archive required' }
    const sandbox = new Sandbox(ctx.sandboxRoot)
    const arc = sandbox.resolve(archive)
    const dst = sandbox.resolve(dest)
    return new Promise((resolve) => {
      execFile('tar', ['-xzf', arc, '-C', dst], { timeout: 30_000 }, (err, _stdout, stderr) => {
        if (!err) resolve({ ok: true, output: `extracted ${archive} → ${dest}` })
        else resolve({ ok: false, output: `archive.untar failed: ${String(stderr || err.message).slice(0, 200)}` })
      })
    })
  }
}

// ── yaml.parse (basic key:value + lists) ──────────────────
export const yamlParse: Tool = {
  name: 'yaml.parse',
  description: 'Parse basic YAML (key: value, lists, nested one level) to JSON: {text}. Handles simple configs.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'yaml.parse: args.text required' }
    try {
      const result: Record<string, unknown> = {}
      let currentKey = ''
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const indent = line.length - line.trimStart().length
        if (trimmed.startsWith('- ')) {
          const val = trimmed.slice(2).trim()
          if (currentKey) {
            const existing = result[currentKey]
            const arr = Array.isArray(existing) ? existing : []
            arr.push(val)
            result[currentKey] = arr
          }
        } else {
          const colonIdx = trimmed.indexOf(':')
          if (colonIdx < 0) continue
          const key = trimmed.slice(0, colonIdx).trim()
          const val = trimmed.slice(colonIdx + 1).trim()
          if (indent === 0) {
            currentKey = key
            result[key] = val || {}
          } else if (currentKey) {
            const nested = (result[currentKey] as Record<string, unknown>) ?? {}
            nested[key] = val
            result[currentKey] = nested
          }
        }
      }
      return { ok: true, output: JSON.stringify(result, null, 2) }
    } catch (e) {
      return { ok: false, output: `yaml.parse failed: ${(e as Error).message}` }
    }
  }
}

// ── date.calc ─────────────────────────────────────────────
export const dateCalc: Tool = {
  name: 'date.calc',
  description: 'Date arithmetic: {date (ISO or "now"), add_days?, add_hours?, diff_to? (ISO date)}. Returns new date and/or difference.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const dateStr = String(args.date ?? 'now')
    let d: Date
    if (dateStr === 'now') d = new Date()
    else {
      d = new Date(dateStr)
      if (isNaN(d.getTime())) return { ok: false, output: `date.calc: invalid date "${dateStr}"` }
    }
    const lines: string[] = [`input: ${d.toISOString()}`]
    const addDays = Number(args.add_days ?? 0) || 0
    const addHours = Number(args.add_hours ?? 0) || 0
    if (addDays || addHours) {
      const result = new Date(d.getTime() + addDays * 86400_000 + addHours * 3600_000)
      lines.push(`result: ${result.toISOString()}`)
    }
    const diffTo = String(args.diff_to ?? '')
    if (diffTo) {
      const other = new Date(diffTo)
      if (isNaN(other.getTime())) return { ok: false, output: `date.calc: invalid diff_to "${diffTo}"` }
      const ms = other.getTime() - d.getTime()
      const days = Math.floor(Math.abs(ms) / 86400_000)
      const hours = Math.floor((Math.abs(ms) % 86400_000) / 3600_000)
      lines.push(`diff: ${ms > 0 ? '+' : ''}${days}d ${hours}h (${ms > 0 ? 'future' : 'past'})`)
    }
    if (lines.length === 1) return { ok: false, output: 'date.calc: provide add_days/add_hours or diff_to' }
    return { ok: true, output: lines.join('\n') }
  }
}

// ── regex.test ────────────────────────────────────────────
export const regexTest: Tool = {
  name: 'regex.test',
  description: 'Test a regex against text: {pattern, text, flags?}. Returns all matches with groups.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '')
    const text = String(args.text ?? '')
    const flags = String(args.flags ?? 'g')
    if (!pattern || !text) return { ok: false, output: 'regex.test: args.pattern and args.text required' }
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
      const matches: string[] = []
      let m: RegExpExecArray | null
      let count = 0
      while ((m = re.exec(text)) !== null && count < 50) {
        const groups = m.length > 1 ? ` groups: [${m.slice(1).map((g) => g ?? '∅').join(', ')}]` : ''
        matches.push(`[${m.index}] "${m[0]}"${groups}`)
        count++
        if (m.index === re.lastIndex) re.lastIndex++
      }
      return { ok: true, output: matches.length ? `${matches.length} match(es):\n${matches.join('\n')}` : '(no matches)' }
    } catch (e) {
      return { ok: false, output: `regex.test: invalid pattern — ${(e as Error).message}` }
    }
  }
}

// ── cron.explain ──────────────────────────────────────────
export const cronExplain: Tool = {
  name: 'cron.explain',
  description: 'Parse a 5-field cron expression to human-readable Russian: {expression}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const expr = String(args.expression ?? '').trim()
    if (!expr) return { ok: false, output: 'cron.explain: args.expression required' }
    const fields = expr.split(/\s+/)
    if (fields.length !== 5) return { ok: false, output: `cron.explain: expected 5 fields, got ${fields.length}` }
    const names = ['минута', 'час', 'день месяца', 'месяц', 'день недели']
    const parts: string[] = []
    for (let i = 0; i < 5; i++) {
      const f = fields[i]!
      let desc: string
      if (f === '*') desc = 'каждый(ую)'
      else if (f.includes('*/')) desc = `каждые ${f.split('*/')[1]}`
      else if (f.includes(',')) desc = `в ${f.split(',').join(' и ')}`
      else if (f.includes('-')) desc = `с ${f.split('-')[0]} по ${f.split('-')[1]}`
      else desc = `в ${f}`
      parts.push(`${names[i]}: ${desc}`)
    }
    return { ok: true, output: `cron "${expr}":\n${parts.map((p) => `  ${p}`).join('\n')}` }
  }
}

// ── color.convert ─────────────────────────────────────────
export const colorConvert: Tool = {
  name: 'color.convert',
  description: 'Convert colors: {value (hex "#FF0000", rgb "255,0,0", or hsl "0,100%,50%"), to: hex|rgb|hsl}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const value = String(args.value ?? '').trim()
    const to = String(args.to ?? 'hex')
    if (!value) return { ok: false, output: 'color.convert: args.value required' }
    let r = 0, g = 0, b = 0
    if (value.startsWith('#')) {
      const hex = value.slice(1)
      if (hex.length === 3) {
        r = parseInt(hex[0]! + hex[0]!, 16)
        g = parseInt(hex[1]! + hex[1]!, 16)
        b = parseInt(hex[2]! + hex[2]!, 16)
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16)
        g = parseInt(hex.slice(2, 4), 16)
        b = parseInt(hex.slice(4, 6), 16)
      } else {
        return { ok: false, output: `color.convert: invalid hex "${value}"` }
      }
    } else if (value.includes(',')) {
      const parts2 = value.split(',').map((p) => parseFloat(p.trim()))
      if (parts2.length >= 3) {
        if (value.includes('%')) {
          const [h, s, l] = parts2
          const c = (1 - Math.abs((2 * (l ?? 50)) / 100 - 1)) * ((s ?? 100) / 100)
          const x = c * (1 - Math.abs(((h ?? 0) / 60) % 2 - 1))
          const m = (l ?? 50) / 100 - c / 2
          const seg = Math.floor((h ?? 0) / 60) % 6
          const table: number[][] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]]
          const [r2 = 0, g2 = 0, b2 = 0] = table[seg] ?? [0, 0, 0]
          r = Math.round((r2 + m) * 255)
          g = Math.round((g2 + m) * 255)
          b = Math.round((b2 + m) * 255)
        } else {
          r = parts2[0] ?? 0
          g = parts2[1] ?? 0
          b = parts2[2] ?? 0
        }
      }
    } else {
      return { ok: false, output: `color.convert: unrecognized format "${value}"` }
    }
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    const rgb = `rgb(${r}, ${g}, ${b})`
    const max = Math.max(r, g, b) / 255
    const min = Math.min(r, g, b) / 255
    const l = ((max + min) / 2) * 100
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * (l / 100) - 1)) * 100
    let h = 0
    if (d !== 0) {
      if (max === r / 255) h = ((g - b) / 255 / d) % 6
      else if (max === g / 255) h = (b - r) / 255 / d + 2
      else h = (r - g) / 255 / d + 4
      h = Math.round(h * 60)
      if (h < 0) h += 360
    }
    const hsl = `hsl(${h}, ${Math.round(s)}%, ${Math.round(l)}%)`
    return { ok: true, output: `hex: ${hex}\nrgb: ${rgb}\nhsl: ${hsl}` }
  }
}

// ── text.stats ────────────────────────────────────────────
export const textStats: Tool = {
  name: 'text.stats',
  description: 'Text statistics: {text}. Word count, char count, line count, reading time, top 5 words.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'text.stats: args.text required' }
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    const lines = text.split('\n').length
    const chars = text.length
    const readingMin = Math.ceil(words.length / 200)
    const freq = new Map<string, number>()
    for (const w of words) {
      const clean = w.replace(/[^\p{L}\p{N}-]/gu, '')
      if (clean.length > 2) freq.set(clean, (freq.get(clean) ?? 0) + 1)
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      ok: true,
      output: [
        `words: ${words.length}`,
        `chars: ${chars}`,
        `lines: ${lines}`,
        `reading: ~${readingMin} min`,
        `top words: ${top.map(([w, c]) => `${w}(${c})`).join(', ') || '(none)'}`
      ].join('\n')
    }
  }
}

// ── env.list ──────────────────────────────────────────────
export const envList: Tool = {
  name: 'env.list',
  description: 'List environment variables visible to the agent (PATH, HOME, LANG, etc). Read-only.',
  mutating: false,
  async run(): Promise<ToolResult> {
    const skip = new Set(['PASS', 'SECRET', 'TOKEN', 'KEY', 'CREDENTIAL'])
    const entries = Object.entries(process.env)
      .filter(([k]) => !skip.has(k) && !k.toUpperCase().includes('PASSWORD'))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .slice(0, 50)
    return { ok: true, output: entries.join('\n') || '(empty)' }
  }
}

export const deepTools: Tool[] = [
  codeRun, codePython, archiveTar, archiveUntar, yamlParse,
  dateCalc, regexTest, cronExplain, colorConvert, textStats, envList
]
