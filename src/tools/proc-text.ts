// Process + text tools: ps, diff, json format.

import { execFile } from 'node:child_process'
import type { Tool, ToolResult } from '../protocol/types.js'
import { lineDiff } from './sandbox.js'

export const processList: Tool = {
  name: 'process.list',
  description: 'Running processes with CPU/RAM: {sort: cpu|mem (default cpu), limit (default 20)}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const sort = String(args.sort ?? 'cpu') === 'mem' ? 'mem' : 'cpu'
    const limit = Math.min(50, Number(args.limit ?? 20) || 20)
    const flag = sort === 'cpu' ? '%cpu' : '%mem'
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
