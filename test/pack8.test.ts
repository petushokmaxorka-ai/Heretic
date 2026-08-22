// PACK 8 hermetic tests: vault-forever (custom root), ctx estimation/trimming.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vaultRemember, vaultRecall } from '../src/tools/vault.js'
import { estimateTokens, trimMessages } from '../src/engine/ctx.js'
import type { ChatMessage } from '../src/protocol/types.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p8-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('vault: honors a persistent vaultRoot (userData-style), not the sandbox', async () => {
  const vaultHome = join(dir, 'forever')
  const sandbox = join(dir, 'tmp-sandbox')
  await vaultRemember.run({ text: 'the user prefers Mechanicus gold' }, { sandboxRoot: sandbox, vaultRoot: vaultHome })
  assert.ok(existsSync(join(vaultHome, 'vault', 'memory.jsonl')), 'memory must live in the persistent root')
  assert.ok(!existsSync(join(sandbox, 'vault')), 'sandbox must not hold the biography')
  const r = await vaultRecall.run({ query: 'user prefers gold' }, { sandboxRoot: sandbox, vaultRoot: vaultHome })
  assert.match(r.output, /Mechanicus gold/)
  // legacy fallback: no vaultRoot → sandbox (back-compat)
  await vaultRemember.run({ text: 'legacy note' }, { sandboxRoot: sandbox })
  assert.ok(existsSync(join(sandbox, 'vault', 'memory.jsonl')))
})

test('estimateTokens: chars/4 + flat image cost', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: 'a'.repeat(400) },
    { role: 'user', content: 'hi', images: ['data:image/png;base64,x'] }
  ]
  const t = estimateTokens(msgs)
  assert.ok(t >= 100 && t <= 120 + 1000 + 10, `sanity: got ${t}`)
})

test('trimMessages: keeps system + newest tail, drops oldest first, marks the cut', () => {
  const system: ChatMessage = { role: 'system', content: 'SYS'.repeat(10) }
  const msgs: ChatMessage[] = [
    system,
    { role: 'user', content: 'x'.repeat(500) },
    { role: 'assistant', content: 'y'.repeat(500) },
    { role: 'user', content: 'z'.repeat(500) },
    { role: 'assistant', content: 'w'.repeat(500) },
    { role: 'user', content: 'NEWEST' }
  ]
  const out = trimMessages(msgs, 1200)
  assert.equal(out[0]!.role, 'system')
  assert.ok(out.some((m) => m.content.includes('NEWEST')), 'newest always kept')
  assert.ok(!out.some((m) => m.content === 'x'.repeat(500)), 'oldest dropped first')
  assert.ok(out.some((m) => m.content.includes('history trimmed')), 'honest cut marker present')
  const total = out.reduce((n, m) => n + m.content.length, 0)
  assert.ok(total < 500 * 4 + 500, `budget respected-ish: ${total}`)
})

test('trimMessages: oversized newest message is middle-truncated honestly', () => {
  const msgs: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'A'.repeat(50_000) }
  ]
  const out = trimMessages(msgs, 4000)
  assert.equal(out.length, 2)
  assert.match(out[1]!.content, /context truncated: message was 50000 chars/)
  assert.ok(out[1]!.content.length < 6000)
})

test('trimMessages: everything fits → untouched', () => {
  const msgs: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'short' },
    { role: 'assistant', content: 'reply' }
  ]
  const out = trimMessages(msgs, 28_000)
  assert.deepEqual(out, msgs)
})
