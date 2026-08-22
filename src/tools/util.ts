// Utility tools: time, crypto, encoding, glob, dice — zero deps.

import { createHash, randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

export const timeNow: Tool = {
  name: 'time.now',
  description: 'Current time: UTC ISO, local, and an optional IANA timezone (args.tz, e.g. Europe/Moscow).',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const now = new Date()
    const tz = String(args.tz ?? '')
    const lines = [`utc: ${now.toISOString()}`, `local: ${now.toString()}`]
    if (tz) {
      try {
        lines.push(`${tz}: ${now.toLocaleString('ru-RU', { timeZone: tz })}`)
      } catch {
        return { ok: false, output: `time.now: unknown timezone "${tz}"` }
      }
    }
    return { ok: true, output: lines.join('\n') }
  }
}

const HASH_ALGOS = new Set(['md5', 'sha1', 'sha256', 'sha512'])

export const cryptoHash: Tool = {
  name: 'crypto.hash',
  description: 'Hash text: {algo: md5|sha1|sha256|sha512 (default sha256), text}. Hex digest.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const algo = String(args.algo ?? 'sha256')
    const text = String(args.text ?? '')
    if (!HASH_ALGOS.has(algo)) return { ok: false, output: `crypto.hash: algo must be one of ${[...HASH_ALGOS].join(', ')}` }
    if (!text) return { ok: false, output: 'crypto.hash: args.text required' }
    return { ok: true, output: createHash(algo).update(text).digest('hex') }
  }
}

export const cryptoUuid: Tool = {
  name: 'crypto.uuid',
  description: 'Generate a random UUID v4.',
  mutating: false,
  async run(): Promise<ToolResult> {
    return { ok: true, output: randomUUID() }
  }
}

export const encodeBase64: Tool = {
  name: 'encode.base64',
  description: 'Base64 encode ({text}) or decode ({text, decode: true}).',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    if (!text) return { ok: false, output: 'encode.base64: args.text required' }
    try {
      if (args.decode === true) {
        return { ok: true, output: Buffer.from(text, 'base64').toString('utf-8') }
      }
      return { ok: true, output: Buffer.from(text, 'utf-8').toString('base64') }
    } catch (e) {
      return { ok: false, output: `encode.base64 failed: ${(e as Error).message}` }
    }
  }
}

/** glob → RegExp: * = within segment, ** = across segments. */
function globToRe(pattern: string): RegExp {
  // tokenise ** units to control-char markers FIRST, so later steps
  // can never eat what earlier steps inserted
  const CROSS = String.fromCharCode(1) // '**/'
  const ANY = String.fromCharCode(2) // '**'
  let p = pattern.split('**/').join(CROSS)
  p = p.split('**').join(ANY)
  const parts = p.split('/').map((seg) => {
    const t = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    return t.split(CROSS).join('(?:[^/]+/)*').split(ANY).join('.*')
  })
  return new RegExp(`^${parts.join('/')}$`)
}

export const fsGlob: Tool = {
  name: 'fs.glob',
  description: 'Find files by glob pattern (e.g. "src/**/*.ts", "notes/*.md") in the sandbox. Up to 200 matches.',
  mutating: false,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '')
    if (!pattern) return { ok: false, output: 'fs.glob: args.pattern required' }
    const sandbox = new Sandbox(ctx.sandboxRoot)
    const re = globToRe(pattern)
    const out: string[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      if (out.length >= 200) return
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          await walk(join(dir, entry.name), rel)
        } else if (re.test(rel)) {
          out.push(rel)
          if (out.length >= 200) return
        }
      }
    }
    await walk(sandbox.root, '')
    return { ok: true, output: out.length ? out.join('\n') : '(no matches)' }
  }
}

export const randomDice: Tool = {
  name: 'random.dice',
  description: 'Roll dice: {count (default 1), sides (default 6), modifier}. WH40k-style output with total. d100 for requisition.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const count = Math.max(1, Math.min(20, Number(args.count ?? 1)))
    const sides = Math.max(2, Math.min(1000, Number(args.sides ?? 6)))
    const mod = Number(args.modifier ?? 0) || 0
    const rolls: number[] = []
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides))
    const total = rolls.reduce((a, b) => a + b, 0) + mod
    const sign = mod >= 0 ? `+${mod}` : `${mod}`
    return { ok: true, output: `${count}d${sides}${mod ? sign : ''}: [${rolls.join(', ')}]${mod ? ` ${sign}` : ''} = ${total}` }
  }
}

export const utilTools: Tool[] = [timeNow, cryptoHash, cryptoUuid, encodeBase64, fsGlob, randomDice]
