// Process + text tools: ps, diff, json format.

import { execFile } from 'node:child_process'
import { totalmem } from 'node:os'
import type { Tool, ToolResult } from '../protocol/types.js'
import { lineDiff } from './sandbox.js'

// Windows has no `ps aux` (Git's MSYS ps, when on PATH, lacks --sort), so
// PowerShell supplies the raw numbers and we render the same ps-aux table.
// -IncludeUserName needs elevation; without it USER falls back to '?'.
const WIN_PS_SCRIPT = [
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "$ErrorActionPreference = 'SilentlyContinue'",
  'try { $procs = Get-Process -IncludeUserName -ErrorAction Stop } catch { $procs = Get-Process }',
  '$now = Get-Date',
  '$rows = foreach ($p in $procs) {',
  '  $cpu = $null; $up = 0',
  '  try { $cpu = $p.CPU } catch {}',
  '  try { if ($p.StartTime) { $up = ($now - $p.StartTime).TotalSeconds } } catch {}',
  '  [pscustomobject]@{ user = $p.UserName; id = $p.Id; cpu = $cpu; up = $up; rss = $p.WorkingSet64; cmd = $p.ProcessName }',
  '}',
  '$rows | ConvertTo-Json -Compress',
  'exit 0'
].join('\n')

interface WinProc {
  user?: string | null
  id?: number
  cpu?: number | null
  up?: number | null
  rss?: number | null
  cmd?: string | null
}

/** Render PowerShell's Get-Process JSON as `ps aux`-style lines (%CPU = cpu time / uptime, like ps). */
export function formatWinProcs(json: string, sort: 'cpu' | 'mem', limit: number, memTotal = totalmem()): string {
  const parsed = JSON.parse(json.replace(/^\uFEFF/, '')) as WinProc | WinProc[] | null
  const list = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
  const rows = list.map((p) => {
    const cpuSec = Number(p.cpu ?? 0)
    const up = Number(p.up ?? 0)
    const rss = Number(p.rss ?? 0)
    return {
      user: String(p.user || '?'),
      pid: String(p.id ?? '?'),
      cpu: up > 0 ? (cpuSec / up) * 100 : 0,
      mem: memTotal > 0 ? (rss / memTotal) * 100 : 0,
      rssKb: Math.round(rss / 1024),
      cmd: String(p.cmd ?? '')
    }
  })
  rows.sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem))
  const table = [['USER', 'PID', '%CPU', '%MEM', 'RSS', 'COMMAND']].concat(
    rows.slice(0, limit).map((r) => [r.user, r.pid, r.cpu.toFixed(1), r.mem.toFixed(1), String(r.rssKb), r.cmd])
  )
  const widths = [0, 1, 2, 3, 4].map((i) => Math.max(...table.map((cells) => (cells[i] ?? '').length)))
  return table
    .map((cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : i < 5 ? c.padStart(widths[i] ?? 0) : c)).join(' '))
    .join('\n')
}

export const processList: Tool = {
  name: 'process.list',
  description: 'Running processes with CPU/RAM: {sort: cpu|mem (default cpu), limit (default 20)}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const sort = String(args.sort ?? 'cpu') === 'mem' ? 'mem' : 'cpu'
    const limit = Math.min(50, Number(args.limit ?? 20) || 20)
    const flag = sort === 'cpu' ? '%cpu' : '%mem'
    if (process.platform === 'win32') {
      const encoded = Buffer.from(WIN_PS_SCRIPT, 'utf16le').toString('base64')
      return new Promise((resolve) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
          (err, stdout) => {
            try {
              if (err || !stdout.trim()) throw err ?? new Error('empty')
              resolve({ ok: true, output: formatWinProcs(stdout, sort, limit) })
            } catch (e) {
              resolve({ ok: false, output: `process.list failed: ${String((e as Error).message)}` })
            }
          }
        )
      })
    }
    return new Promise((resolve) => {
      execFile('ps', ['aux', '--sort=-' + flag], { timeout: 5000, maxBuffer: 256 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          resolve({ ok: false, output: `process.list failed: ${String(err?.message ?? 'empty')}` })
          return
        }
        const lines = stdout.trim().split('\n')
        const header = lines[0] ?? ''
        const rows = lines.slice(1, limit + 1)
        resolve({ ok: true, output: [header, ...rows].join('\n') })
      })
    })
  }
}

export const textDiff: Tool = {
  name: 'text.diff',
  description: 'Line diff between two texts: {a, b}. Returns +/- sample with counts.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const a = String(args.a ?? '')
    const b = String(args.b ?? '')
    if (!a && !b) return { ok: false, output: 'text.diff: args.a and args.b required' }
    const d = lineDiff(a, b)
    const lines = [...d.sample.map((l) => l), ...a.split('\n').filter((l) => !b.includes(l)).slice(0, 5).map((l) => `- ${l}`)]
    return { ok: true, output: `+${d.added} / -${d.removed} lines\n${lines.join('\n') || '(identical)'}` }
  }
}

export const jsonFormat: Tool = {
  name: 'json.format',
  description: 'Pretty-print / validate JSON: {text}. Returns formatted or error with position.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text.trim()) return { ok: false, output: 'json.format: args.text required' }
    try {
      const parsed = JSON.parse(text) as unknown
      return { ok: true, output: JSON.stringify(parsed, null, 2).slice(0, 32_000) }
    } catch (e) {
      return { ok: false, output: `json.format: invalid JSON — ${(e as Error).message}` }
    }
  }
}

export const procTextTools: Tool[] = [processList, textDiff, jsonFormat]
