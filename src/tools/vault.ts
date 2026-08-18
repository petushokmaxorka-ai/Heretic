// ═══════════════════════════════════════════════════════════
// Vault memory — the organism's long-term memory (zero deps)
// ═══════════════════════════════════════════════════════════
// Append-only JSONL inside the sandbox; recall = naive keyword
// scoring (embeddings come later as an optional upgrade).
// Transparency law: every remember/recall is a ledger step.

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../protocol/types.js'

interface VaultEntry {
  t: string
  text: string
}

function vaultPath(ctx: ToolContext): string {
  return join(ctx.sandboxRoot, 'vault', 'memory.jsonl')
}

async function readVault(ctx: ToolContext): Promise<VaultEntry[]> {
  const raw = await readFile(vaultPath(ctx), 'utf-8').catch(() => '')
  const entries: VaultEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as VaultEntry)
    } catch {
      // skip corrupted line, memory survives
    }
  }
  return entries
}

function score(entry: VaultEntry, words: string[]): number {
  const hay = entry.text.toLowerCase()
  let s = 0
  for (const w of words) {
    if (w.length > 2 && hay.includes(w)) s++
  }
  return s
}

export const vaultRemember: Tool = {
  name: 'memory.remember',
  description: 'Save a fact to long-term memory (survives sessions). One concise fact per call.',
  mutating: false, // append-only inside the sandbox — the organism's own notebook
  async run(args, ctx): Promise<ToolResult> {
    const text = String(args.text ?? '').trim()
    if (!text) return { ok: false, output: 'memory.remember: args.text required' }
    const file = vaultPath(ctx)
    await mkdir(join(file, '..'), { recursive: true })
    await appendFile(file, JSON.stringify({ t: new Date().toISOString(), text }) + '\n', 'utf-8')
    return { ok: true, output: `remembered: ${text.slice(0, 100)}` }
  }
}

export const vaultRecall: Tool = {
  name: 'memory.recall',
  description: 'Search long-term memory by keywords; returns the most relevant remembered facts.',
  mutating: false,
  async run(args, ctx): Promise<ToolResult> {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'memory.recall: args.query required' }
    const entries = await readVault(ctx)
    if (!entries.length) return { ok: true, output: '(memory is empty)' }
    const words = query.toLowerCase().split(/\s+/)
    const ranked = entries
      .map((e) => ({ e, s: score(e, words) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
    if (!ranked.length) return { ok: true, output: '(nothing relevant in memory)' }
    return {
      ok: true,
      output: ranked.map((r) => `[${r.e.t.slice(0, 10)}] ${r.e.text}`).join('\n')
    }
  }
}

export const vaultTools: Tool[] = [vaultRemember, vaultRecall]
