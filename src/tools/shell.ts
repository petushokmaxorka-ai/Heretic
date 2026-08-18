// shell tool — allowlisted binaries only, spawn without shell, sandbox cwd,
// hard timeout. Anything outside the list is rejected before it executes.

import { spawn } from 'node:child_process'
import type { Tool, ToolResult } from '../protocol/types.js'

const ALLOWED = new Set(['echo', 'pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep'])
const TIMEOUT_MS = 10_000
const MAX_OUT = 4096

export const shellTool: Tool = {
  name: 'shell',
  description: `Run an allowlisted command (${[...ALLOWED].join(', ')}) in the sandbox cwd. No shell features, no pipes.`,
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    const command = String(args.command ?? '').trim()
    if (!command) return { ok: false, output: 'shell: args.command required' }
    const parts = command.split(/\s+/)
    const bin = parts[0] ?? ''
    if (!ALLOWED.has(bin)) {
      return { ok: false, output: `shell: "${bin}" is not in the allowlist (${[...ALLOWED].join(', ')})` }
    }
    return new Promise<ToolResult>((resolve) => {
      const child = spawn(bin, parts.slice(1), {
        cwd: ctx.sandboxRoot,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: ctx.sandboxRoot },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let out = ''
      const sink = (chunk: Buffer): void => {
        if (out.length < MAX_OUT) out += chunk.toString('utf-8')
      }
      child.stdout.on('data', sink)
      child.stderr.on('data', sink)
      const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, output: `shell: ${e.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const text = out.trim().slice(0, MAX_OUT) || '(no output)'
        if (code === 0) resolve({ ok: true, output: text })
        else resolve({ ok: false, output: `shell: exit ${code}\n${text}` })
      })
    })
  }
}
