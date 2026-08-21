// PACK 1 hermetic tests: abort, diff previews, policy diff passthrough.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../src/engine/agent.js'
import { EchoBrain } from '../src/brains/echo.js'
import { autoAllow } from '../src/engine/policy.js'
import { previewFor } from '../src/engine/preview.js'
import { fsTools } from '../src/tools/fs.js'
import { Sandbox } from '../src/tools/sandbox.js'
import type { ApprovalDiff } from '../src/protocol/types.js'

const fence = (name: string, args: Record<string, unknown>): string =>
  '```tool\n' + JSON.stringify({ name, args }) + '\n```'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p1-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('abort: pre-aborted signal returns honestly without touching the brain', async () => {
  const brain = new EchoBrain([fence('fs.write', { path: 'x.txt', content: 'nope' })])
  const controller = new AbortController()
  controller.abort()
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow,
    signal: controller.signal
  })
  assert.equal(result.ok, false)
  assert.equal(result.aborted, true)
  assert.match(result.steps.at(-1)!.detail, /stopped by user/)
})

test('abort: mid-session stop after first step', async () => {
  const controller = new AbortController()
  const brain = new EchoBrain([
    fence('fs.write', { path: 'a.txt', content: 'first' }),
    fence('fs.write', { path: 'b.txt', content: 'second' }),
    'DONE'
  ])
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow,
    signal: controller.signal,
    onStep: () => controller.abort()
  })
  assert.equal(result.aborted, true)
  assert.equal(result.ok, false)
})

test('previewFor: fs.write on new file shows empty before', async () => {
  const d = await previewFor('fs.write', { path: 'new.txt', content: 'hello' }, dir)
  assert.notEqual(d, undefined)
  assert.equal(d!.before, '')
  assert.equal(d!.after, 'hello')
})

test('previewFor: fs.edit shows surgical change and honest not-found', async () => {
  writeFileSync(join(dir, 'cfg.txt'), 'port=1111\nhost=x\n')
  const found = await previewFor('fs.edit', { path: 'cfg.txt', old: '1111', new: '2222' }, dir)
  assert.equal(found!.after, 'port=2222\nhost=x\n')
  const missing = await previewFor('fs.edit', { path: 'cfg.txt', old: 'zzz', new: 'q' }, dir)
  assert.match(missing!.after, /not found/)
})

test('previewFor: non-write tools and escapes yield undefined', async () => {
  assert.equal(await previewFor('shell', { command: 'ls' }, dir), undefined)
  assert.equal(await previewFor('fs.write', { path: '../out.txt', content: 'x' }, dir), undefined)
})

test('policy receives the diff before fs.write executes', async () => {
  const seen: { action: string; diff?: ApprovalDiff }[] = []
  const brain = new EchoBrain([fence('fs.write', { path: 'note.txt', content: 'payload' }), 'OK'])
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: {
      allow: async (action, _detail, diff) => {
        seen.push({ action, diff })
        return true
      }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.action, 'fs.write')
  assert.equal(seen[0]!.diff?.after, 'payload')
  assert.equal(seen[0]!.diff?.before, '')
})
