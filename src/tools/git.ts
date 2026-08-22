// git tools — read-only git inspection via spawn (no shell, cwd = sandbox).
// The agent sees history and diffs before editing; writes stay manual.

import { execFile } from 'node:child_process'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

const TIMEOUT = 8000
const MAX_OUT = 8000

function git(args: string[], ctx: ToolContext): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: ctx.sandboxRoot, timeout: TIMEOUT, maxBuffer: 1024 * 256, shell: false },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ ok: false, output: `git ${args[0]} failed: ${String(stderr || err.message).slice(0, 200)}` })
          return
        }
        resolve({ ok: true, output: String(stdout).slice(0, MAX_OUT) || '(empty)' })
      }
    )
  })
}

export const gitStatus: Tool = {
  name: 'git.status',
  description: 'git status --short --branch in the sandbox (workspace repo). Read-only.',
  mutating: false,
  run: (_args, ctx) => git(['status', '--short', '--branch'], ctx)
}

export const gitDiff: Tool = {
  name: 'git.diff',
  description: 'git diff (unstaged) + staged in the sandbox. Read-only.',
  mutating: false,
  run: async (args, ctx) => {
    const staged = args.staged === true
    return git(staged ? ['diff', '--cached'] : ['diff'], ctx)
  }
}

export const gitLog: Tool = {
  name: 'git.log',
  description: 'git log --oneline (last 30) in the sandbox. Read-only.',
  mutating: false,
  run: (_args, ctx) => git(['log', '--oneline', '-30'], ctx)
}

export const gitTools: Tool[] = [gitStatus, gitDiff, gitLog]
