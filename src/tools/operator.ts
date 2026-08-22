// Operator tools: git write, docker, systemd, JSON queries, text transforms,
// string metrics, humanization — zero-dep where possible.

import { execFile } from 'node:child_process'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

const TIMEOUT = 10_000

function run(cmd: string, args: string[], cwd?: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: TIMEOUT, maxBuffer: 256 * 1024, shell: false }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve({ ok: false, output: `${cmd} failed: ${String(stderr || err.message).slice(0, 300)}` })
      } else {
        resolve({ ok: true, output: String(stdout).trim().slice(0, 12_000) || '(empty)' })
      }
    })
  })
}

// ── Git write operations ──────────────────────────────────
export const gitAdd: Tool = {
  name: 'git.add',
  description: 'Stage files: {paths: ["file1", "dir/"]}. Use "." for all.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const paths = (Array.isArray(args.paths) ? (args.paths as unknown[]) : ['.']).map(String)
    return run('git', ['add', ...paths], ctx.sandboxRoot)
  }
}

export const gitCommit: Tool = {
  name: 'git.commit',
  description: 'Commit staged changes: {message}. Requires git.add first.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const message = String(args.message ?? '')
    if (!message.trim()) return { ok: false, output: 'git.commit: args.message required' }
    return run('git', ['commit', '-m', message], ctx.sandboxRoot)
  }
}

export const gitBranch: Tool = {
  name: 'git.branch',
  description: 'Branch operations: {action: list|create|switch (default list), name?}. Create and switch need args.name.',
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const action = String(args.action ?? 'list')
    const name = String(args.name ?? '')
    if (action === 'list') return run('git', ['branch', '-a'], ctx.sandboxRoot)
    if (!name) return { ok: false, output: `git.branch: args.name required for action "${action}"` }
    if (action === 'create') return run('git', ['checkout', '-b', name], ctx.sandboxRoot)
    if (action === 'switch') return run('git', ['checkout', name], ctx.sandboxRoot)
    return { ok: false, output: `git.branch: unknown action "${action}" (list|create|switch)` }
  }
}

// ── Docker ────────────────────────────────────────────────
export const dockerPs: Tool = {
  name: 'docker.ps',
  description: 'List Docker containers: {all?: boolean (default true)}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const all = args.all !== false
    return run('docker', ['ps', ...(all ? ['-a'] : []), '--format', 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'])
  }
}

export const dockerLogs: Tool = {
  name: 'docker.logs',
  description: 'Container logs: {container, lines? (default 50)}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const container = String(args.container ?? '')
    if (!container) return { ok: false, output: 'docker.logs: args.container required' }
    const lines = Math.min(500, Number(args.lines ?? 50) || 50)
    return run('docker', ['logs', '--tail', String(lines), container])
  }
}

// ── Systemd user units ────────────────────────────────────
export const systemdStatus: Tool = {
  name: 'systemd.status',
  description: 'User service status: {unit}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const unit = String(args.unit ?? '')
    if (!unit) return { ok: false, output: 'systemd.status: args.unit required' }
    return run('systemctl', ['--user', 'status', unit, '--no-pager', '-n', '5'])
  }
}

export const systemdList: Tool = {
  description: 'List user services: {state: running|failed|all (default running)}. Read-only.',
  name: 'systemd.list',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const state = String(args.state ?? 'running')
    const flag = state === 'all' ? [] : [`--state=${state}`]
    return run('systemctl', ['--user', 'list-units', '--type=service', ...flag, '--no-pager', '--plain'])
  }
}

// ── JSON path query ───────────────────────────────────────
export const jsonPath: Tool = {
  name: 'json.path',
  description: 'Query JSON with dot notation: {data (JSON string or object), path: "a.b.0.c"}. Returns the value at path.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const path = String(args.path ?? '')
    if (!path) return { ok: false, output: 'json.path: args.path required' }
    let data: unknown
    if (typeof args.data === 'string') {
      try {
        data = JSON.parse(args.data)
      } catch (e) {
        return { ok: false, output: `json.path: invalid JSON — ${(e as Error).message}` }
      }
    } else {
      data = args.data
    }
    const parts = path.split('.')
    let current: unknown = data
    for (const part of parts) {
      if (current === null || current === undefined) {
        return { ok: false, output: `json.path: null/undefined at "${part}"` }
      }
      if (Array.isArray(current)) {
        const idx = parseInt(part, 10)
        if (isNaN(idx)) return { ok: false, output: `json.path: expected array index, got "${part}"` }
        current = current[idx]
      } else if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return { ok: false, output: `json.path: cannot descend into ${typeof current} at "${part}"` }
      }
    }
    if (current === undefined) return { ok: false, output: `json.path: path "${path}" not found` }
    return { ok: true, output: typeof current === 'object' ? JSON.stringify(current, null, 2) : String(current) }
  }
}

// ── JSON deep merge ───────────────────────────────────────
function deepMerge(a: unknown, b: unknown): unknown {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return b
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
  const result: Record<string, unknown> = { ...(a as Record<string, unknown>) }
  for (const [key, val] of Object.entries(b as Record<string, unknown>)) {
    if (key in result) {
      result[key] = deepMerge(result[key], val)
    } else {
      result[key] = val
    }
  }
  return result
}

export const jsonMerge: Tool = {
  name: 'json.merge',
  description: 'Deep merge two JSON objects: {a, b}. Arrays concatenated, objects merged recursively, b wins on conflicts.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const parse = (v: unknown): unknown => {
      if (typeof v === 'string') return JSON.parse(v)
      return v
    }
    try {
      const a = parse(args.a)
      const b = parse(args.b)
      const merged = deepMerge(a, b)
      return { ok: true, output: JSON.stringify(merged, null, 2) }
    } catch (e) {
      return { ok: false, output: `json.merge: ${(e as Error).message}` }
    }
  }
}

// ── Text case conversions ─────────────────────────────────
export const textCase: Tool = {
  name: 'text.case',
  description: 'Convert text case: {text, to: camel|snake|kebab|pascal|title|upper|lower|constant}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    const to = String(args.to ?? '')
    if (!text) return { ok: false, output: 'text.case: args.text required' }
    const words = text.replace(/[-_\s]+/g, ' ').trim().split(' ').filter(Boolean)
    const lower = words.map((w) => w.toLowerCase())
    let result: string
    switch (to) {
      case 'camel':
        result = lower.map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)).join('')
        break
      case 'pascal':
        result = lower.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
        break
      case 'snake':
        result = lower.join('_')
        break
      case 'kebab':
        result = lower.join('-')
        break
      case 'constant':
        result = lower.join('_').toUpperCase()
        break
      case 'title':
        result = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        break
      case 'upper':
        result = text.toUpperCase()
        break
      case 'lower':
        result = text.toLowerCase()
        break
      default:
        return { ok: false, output: `text.case: unknown case "${to}". Use: camel|snake|kebab|pascal|title|upper|lower|constant` }
    }
    return { ok: true, output: result }
  }
}

// ── Slug generator ────────────────────────────────────────
export const textSlug: Tool = {
  name: 'text.slug',
  description: 'Generate URL-safe slug: {text, separator? (default "-")}. Transliterates Cyrillic.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    const sep = String(args.separator ?? '-')
    if (!text.trim()) return { ok: false, output: 'text.slug: args.text required' }
    const translit: Record<string, string> = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
    }
    const slug = text
      .toLowerCase()
      .split('')
      .map((c) => translit[c] ?? c)
      .join('')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, sep)
      .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '')
    return { ok: true, output: slug || '(empty slug)' }
  }
}

// ── String similarity (Levenshtein) ───────────────────────
export const stringSimilarity: Tool = {
  name: 'string.similarity',
  description: 'Levenshtein distance and similarity ratio: {a, b}. Returns distance + percentage.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const a = String(args.a ?? '')
    const b = String(args.b ?? '')
    if (!a || !b) return { ok: false, output: 'string.similarity: args.a and args.b required' }
    const m = a.length
    const n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i]![0] = i
    for (let j = 0; j <= n; j++) dp[0]![j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
      }
    }
    const distance = dp[m]![n]!
    const maxLength = Math.max(m, n)
    const similarity = maxLength > 0 ? ((maxLength - distance) / maxLength * 100).toFixed(1) : '100.0'
    return { ok: true, output: `distance: ${distance}\nsimilarity: ${similarity}%` }
  }
}

// ── Humanize ──────────────────────────────────────────────
export const humanizeBytes: Tool = {
  name: 'humanize.bytes',
  description: 'Convert bytes to human-readable: {bytes}. E.g. 1536 → "1.5 KB".',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const bytes = Number(args.bytes)
    if (!Number.isFinite(bytes)) return { ok: false, output: 'humanize.bytes: args.bytes (number) required' }
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    let val = bytes
    let i = 0
    while (val >= 1024 && i < units.length - 1) {
      val /= 1024
      i++
    }
    return { ok: true, output: `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}` }
  }
}

export const humanizeDuration: Tool = {
  name: 'humanize.duration',
  description: 'Convert seconds to human-readable duration: {seconds}. E.g. 5400 → "1h 30m".',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const seconds = Number(args.seconds)
    if (!Number.isFinite(seconds)) return { ok: false, output: 'humanize.duration: args.seconds (number) required' }
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const parts: string[] = []
    if (d) parts.push(`${d}d`)
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (s || parts.length === 0) parts.push(`${s}s`)
    return { ok: true, output: parts.join(' ') }
  }
}

// ── Interval parse ────────────────────────────────────────
export const intervalParse: Tool = {
  name: 'interval.parse',
  description: 'Parse human interval to seconds: {text: "1h30m", "2d", "45s", "1w"}. Returns seconds and human-readable.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '').trim()
    if (!text) return { ok: false, output: 'interval.parse: args.text required' }
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }
    const re = /(\d+(?:\.\d+)?)([smhdw])/g
    let total = 0
    let m: RegExpExecArray | null
    let matched = false
    while ((m = re.exec(text)) !== null) {
      matched = true
      const val = parseFloat(m[1]!)
      const unit = m[2]!
      total += val * (units[unit] ?? 0)
    }
    if (!matched) return { ok: false, output: `interval.parse: no valid intervals in "${text}" (use: 1s, 5m, 2h, 3d, 1w)` }
    return { ok: true, output: `${total}s (${text})` }
  }
}

export const operatorTools: Tool[] = [
  gitAdd, gitCommit, gitBranch, dockerPs, dockerLogs,
  systemdStatus, systemdList, jsonPath, jsonMerge,
  textCase, textSlug, stringSimilarity, humanizeBytes, humanizeDuration, intervalParse
]
