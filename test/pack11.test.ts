// PACK 11: background shell trio, ask.user, fs.read pagination

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shellBackground, shellOutput, shellKill } from '../src/tools/shell-bg.js'
import { askUser } from '../src/tools/agent-extra.js'
import { fsWrite, fsRead } from '../src/tools/fs.js'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p11-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('shell.background: start → poll output → kill', async () => {
  const start = await shellBackground.run({ command: 'node -e setTimeout(()=>console.log(42),300)' }, { sandboxRoot: dir })
  assert.equal(start.ok, true)
  const id = start.output.split(' ')[1]!.replace(/:$/, '')
  await sleep(600)
  const poll = await shellOutput.run({ id }, { sandboxRoot: dir })
  assert.match(poll.output, /exited \(0\)/)
  assert.match(poll.output, /42/)
  const stale = await shellOutput.run({ id }, { sandboxRoot: dir })
  assert.equal(stale.ok, true)
  const killed = await shellKill.run({ id }, { sandboxRoot: dir })
  assert.equal(killed.ok, true)
})

test('shell.background: non-allowlisted rejected', async () => {
  const r = await shellBackground.run({ command: 'rm -rf /' }, { sandboxRoot: dir })
  assert.equal(r.ok, false)
  assert.match(r.output, /allowlist/)
})

test('ask.user: surfaces question, returns answer; no surface degrades', async () => {
  const asked: string[] = []
  const ctx = { sandboxRoot: dir, ask: async (q: string, opts?: string[]): Promise<string> => {
    asked.push(q + '|' + (opts ?? []).join(','))
    return 'yes — делай'
  } }
  const r = await askUser.run({ question: 'использовать codex?', options: ['yes', 'no'] }, ctx)
  assert.equal(r.ok, true)
  assert.match(r.output, /yes/)
  assert.deepEqual(asked, ['использовать codex?|yes,no'])
  const bare = await askUser.run({ question: 'q' }, { sandboxRoot: dir })
  assert.equal(bare.ok, false)
  assert.match(bare.output, /no interactive/)
})

test('fs.read: offset/limit pagination', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`)
  await fsWrite.run({ path: 'big.txt', content: lines.join('\n') }, { sandboxRoot: dir })
  const page = await fsRead.run({ path: 'big.txt', offset: 10, limit: 5 }, { sandboxRoot: dir })
  assert.match(page.output, /line-10/)
  assert.match(page.output, /line-14/)
  assert.ok(!page.output.includes('line-15\n'))
  assert.match(page.output, /\[lines 10-15 of 100\]/)
})
