// Background shell trio (Claude Code BashOutput/KillShell parity):
// long-running commands return a task id immediately; poll output; kill.
// Allowlist still applies. Tasks die with the process map on clear().

import { spawn, type ChildProcess } from 'node:child_process'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

const ALLOWED = new Set(['node', 'npm', 'git', 'python3', 'pip', 'curl', 'ping', 'tail', 'ssh'])
const MAX_TASKS = 8
const MAX_POLL = 8000

interface BgTask {
  proc: ChildProcess
  out: string
  started: number
  done: boolean
  code: number | null
}

const tasks = new Map<string, BgTask>()

function reap(): void {
  const now = Date.now()
  for (const [id, t] of tasks) {
    if (t.done && now - t.started > 600_000) tasks.delete(id)
    if (tasks.size <= MAX_TASKS) break
  }
  while (tasks.size > MAX_TASKS) {
    const oldest = [...tasks.entries()].sort((a, b) => a[1].started - b[1].started)[0]
    if (!oldest) break
    oldest[1].proc.kill('SIGKILL')
    tasks.delete(oldest[0])
  }
}

export const shellBackground: Tool = {
  name: 'shell.background',
  description: `Run a LONG allowlisted command (${[...ALLOWED].join(', ')}) in the background. Returns {id} immediately. Poll with shell.output, stop with shell.kill.`,
  mutating: true,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '').trim()
    if (!command) return { ok: false, output: 'shell.background: args.command required' }
    const parts = command.split(/\s+/)
    const bin = parts[0] ?? ''
    if (!ALLOWED.has(bin)) {
      return { ok: false, output: `shell.background: "${bin}" not in the allowlist (${[...ALLOWED].join(', ')})` }
    }
    reap()
    const id = `bg-${Date.now().toString(36)}`
    const proc = spawn(bin, parts.slice(1), {
      cwd: ctx.sandboxRoot,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: ctx.sandboxRoot },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const task: BgTask = { proc, out: '', started: Date.now(), done: false, code: null }
    tasks.set(id, task)
    const sink = (c: Buffer): void => {
      if (task.out.length < 256_000) task.out += c.toString('utf-8')
    }
    proc.stdout?.on('data', sink)
    proc.stderr?.on('data', sink)
    proc.on('close', (code) => {
      task.done = true
      task.code = code
    })
    proc.on('error', () => {
      task.done = true
      task.code = -1
    })
    return { ok: true, output: `started ${id}: ${command}` }
  }
}

export const shellOutput: Tool = {
  name: 'shell.output',
  description: 'Poll a background task: {id}. Returns new output since the last poll plus running/exit status.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const id = String(args.id ?? '')
    const t = tasks.get(id)
    if (!t) return { ok: false, output: `shell.output: unknown task ${id}` }
    const chunk = t.out.slice(0, MAX_POLL)
    t.out = t.out.slice(chunk.length)
    const status = t.done ? `exited (${t.code})` : 'running'
    return { ok: true, output: `[${status}]\n${chunk || '(no new output)'}` }
  }
}

export const shellKill: Tool = {
  name: 'shell.kill',
  description: 'Stop a background task: {id}.',
  mutating: true,
  async run(args): Promise<ToolResult> {
    const id = String(args.id ?? '')
    const t = tasks.get(id)
    if (!t) return { ok: false, output: `shell.kill: unknown task ${id}` }
    t.proc.kill('SIGTERM')
    return { ok: true, output: `killed ${id}` }
  }
}

export const shellBgTools: Tool[] = [shellBackground, shellOutput, shellKill]
