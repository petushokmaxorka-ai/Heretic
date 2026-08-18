// fs tools — sandboxed read / write (with diff) / list.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox, lineDiff } from './sandbox.js'

const MAX_READ = 65_536

function sb(ctx: ToolContext): Sandbox {
  return new Sandbox(ctx.sandboxRoot)
}

export const fsRead: Tool = {
  name: 'fs.read',
  description: 'Read a UTF-8 text file (sandbox-relative path).',
  mutating: false,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const path = String(args.path ?? '')
      if (!path) return { ok: false, output: 'fs.read: args.path required' }
      const raw = await readFile(sb(ctx).resolve(path), 'utf-8')
      return { ok: true, output: raw.length > MAX_READ ? raw.slice(0, MAX_READ) + '\n[truncated]' : raw }
    } catch (e) {
      return { ok: false, output: `fs.read failed: ${(e as Error).message}` }
    }
  }
}

export const fsWrite: Tool = {
  name: 'fs.write',
  description: 'Write a UTF-8 text file (sandbox-relative path). Passes through approval.',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const path = String(args.path ?? '')
      const content = String(args.content ?? '')
      if (!path) return { ok: false, output: 'fs.write: args.path required' }
      const sandbox = sb(ctx)
      const abs = sandbox.resolve(path)
      const old = await readFile(abs, 'utf-8').catch(() => '')
      const diff = lineDiff(old, content)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf-8')
      const preview = diff.sample.length ? '\n' + diff.sample.join('\n') : ''
      return { ok: true, output: `wrote ${path} (+${diff.added}/-${diff.removed} lines)${preview}` }
    } catch (e) {
      return { ok: false, output: `fs.write failed: ${(e as Error).message}` }
    }
  }
}

export const fsList: Tool = {
  name: 'fs.list',
  description: 'List sandbox directory entries (recursive, relative paths).',
  mutating: false,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const sandbox = sb(ctx)
      const base = sandbox.resolve(String(args.path ?? '.'))
      const out: string[] = []
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          out.push(entry.isDirectory() ? `${rel}/` : rel)
          if (entry.isDirectory() && out.length < 500) {
            await walk(join(dir, entry.name), rel)
          }
        }
      }
      await walk(base, '')
      return { ok: true, output: out.length ? out.join('\n') : '(empty)' }
    } catch (e) {
      return { ok: false, output: `fs.list failed: ${(e as Error).message}` }
    }
  }
}

export const fsTools: Tool[] = [fsRead, fsWrite, fsList]
