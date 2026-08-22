// fs tools — sandboxed read / write (with diff) / list.

import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
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

export const fsEdit: Tool = {
  name: 'fs.edit',
  description:
    'Edit a file precisely: replace exact text `old` with `new` (first occurrence; all=true for every occurrence). Fails honestly when `old` is not found — nothing is written.',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const path = String(args.path ?? '')
      const oldText = String(args.old ?? '')
      const newText = String(args.new ?? '')
      if (!path || !oldText) return { ok: false, output: 'fs.edit: args.path and args.old are required' }
      const abs = sb(ctx).resolve(path)
      const src = await readFile(abs, 'utf-8').catch(() => null)
      if (src === null) return { ok: false, output: `fs.edit: file not found: ${path}` }
      let count = 0
      let out: string
      if (args.all === true) {
        count = src.split(oldText).length - 1
        out = count ? src.split(oldText).join(newText) : src
      } else {
        const i = src.indexOf(oldText)
        if (i < 0) {
          count = 0
          out = src
        } else {
          count = 1
          out = src.slice(0, i) + newText + src.slice(i + oldText.length)
        }
      }
      if (count === 0) {
        return { ok: false, output: `fs.edit: old text not found in ${path} — nothing changed (file untouched)` }
      }
      await writeFile(abs, out, 'utf-8')
      return { ok: true, output: `edited ${path}: ${count} replacement(s), file is now ${out.length} chars` }
    } catch (e) {
      return { ok: false, output: `fs.edit failed: ${(e as Error).message}` }
    }
  }
}

export const fsMove: Tool = {
  name: 'fs.move',
  description: 'Move/rename a file or directory inside the sandbox.',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const from = String(args.from ?? '')
      const to = String(args.to ?? '')
      if (!from || !to) return { ok: false, output: 'fs.move: args.from and args.to required' }
      const box = sb(ctx)
      await rename(box.resolve(from), box.resolve(to))
      return { ok: true, output: `moved ${from} -> ${to}` }
    } catch (e) {
      return { ok: false, output: `fs.move failed: ${(e as Error).message}` }
    }
  }
}

export const fsCopy: Tool = {
  name: 'fs.copy',
  description: 'Copy a file inside the sandbox.',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const from = String(args.from ?? '')
      const to = String(args.to ?? '')
      if (!from || !to) return { ok: false, output: 'fs.copy: args.from and args.to required' }
      const box = sb(ctx)
      await copyFile(box.resolve(from), box.resolve(to))
      return { ok: true, output: `copied ${from} -> ${to}` }
    } catch (e) {
      return { ok: false, output: `fs.copy failed: ${(e as Error).message}` }
    }
  }
}

export const fsDelete: Tool = {
  name: 'fs.delete',
  description: 'Delete a file inside the sandbox (SKULL watches for destructive patterns).',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const path = String(args.path ?? '')
      if (!path) return { ok: false, output: 'fs.delete: args.path required' }
      await unlink(sb(ctx).resolve(path))
      return { ok: true, output: `deleted ${path}` }
    } catch (e) {
      return { ok: false, output: `fs.delete failed: ${(e as Error).message}` }
    }
  }
}

export const fsMkdir: Tool = {
  name: 'fs.mkdir',
  description: 'Create a directory (nested) inside the sandbox.',
  mutating: true,
  async run(args, ctx): Promise<ToolResult> {
    try {
      const path = String(args.path ?? '')
      if (!path) return { ok: false, output: 'fs.mkdir: args.path required' }
      await mkdir(sb(ctx).resolve(path), { recursive: true })
      return { ok: true, output: `mkdir ${path}` }
    } catch (e) {
      return { ok: false, output: `fs.mkdir failed: ${(e as Error).message}` }
    }
  }
}

export const fsTools: Tool[] = [fsRead, fsWrite, fsList, fsEdit, fsMove, fsCopy, fsDelete, fsMkdir]
