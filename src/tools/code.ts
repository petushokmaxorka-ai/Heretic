// code.search — regex grep across sandbox text files.
// Read-only, bounded (file count, size, match count) — agent's memory
// of its own workspace.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

const MAX_FILE_BYTES = 262_144
const MAX_FILES = 400
const MAX_MATCHES = 50

export const codeSearch: Tool = {
  name: 'code.search',
  description: 'Search the sandbox with a regex. Returns file:line matches (up to 50). Use it to find code or text before editing.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    try {
      const pattern = String(args.pattern ?? '')
      if (!pattern) return { ok: false, output: 'code.search: args.pattern required' }
      let re: RegExp
      try {
        re = new RegExp(pattern, 'i')
      } catch (e) {
        return { ok: false, output: `code.search: invalid regex — ${(e as Error).message}` }
      }
      const sandbox = new Sandbox(ctx.sandboxRoot)
      const matches: string[] = []
      let filesSeen = 0

      const walk = async (dir: string): Promise<void> => {
        if (filesSeen >= MAX_FILES || matches.length >= MAX_MATCHES) return
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (filesSeen >= MAX_FILES || matches.length >= MAX_MATCHES) return
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
            await walk(full)
            continue
          }
          const info = await stat(full).catch(() => null)
          if (!info || info.size > MAX_FILE_BYTES || info.size === 0) continue
          filesSeen++
          const text = await readFile(full, 'utf-8').catch(() => null)
          if (text === null || text.includes('\u0000')) continue // binary
          const rel = relative(sandbox.root, full)
          for (const [i, line] of text.split('\n').entries()) {
            if (matches.length >= MAX_MATCHES) break
            if (re.test(line)) {
              matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, 160)}`)
            }
          }
        }
      }

      await walk(sandbox.resolve(String(args.path ?? '.')))
      if (!matches.length) return { ok: true, output: '(no matches)' }
      return { ok: true, output: matches.join('\n') + (matches.length >= MAX_MATCHES ? '\n(truncated at 50)' : '') }
    } catch (e) {
      return { ok: false, output: `code.search failed: ${(e as Error).message}` }
    }
  }
}
