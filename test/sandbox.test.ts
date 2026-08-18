import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Sandbox, lineDiff } from '../src/tools/sandbox.js'
import { fsWrite, fsRead } from '../src/tools/fs.js'
import { shellTool } from '../src/tools/shell.js'
import { routeTask } from '../src/router.js'

let dir: string

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-test-'))
})

test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('sandbox: resolves inside root', () => {
  const sb = new Sandbox(dir)
  assert.equal(sb.resolve('a.txt'), join(sb.root, 'a.txt'))
  assert.equal(sb.resolve('./nested/b.txt'), join(sb.root, 'nested/b.txt'))
})

test('sandbox: rejects escapes', () => {
  const sb = new Sandbox(dir)
  assert.throws(() => sb.resolve('../escape.txt'))
  assert.throws(() => sb.resolve('../../etc/passwd'))
  assert.throws(() => sb.resolve('/etc/passwd'))
})

test('fs.write + fs.read roundtrip', async () => {
  const res = await fsWrite.run({ path: 'notes/a.txt', content: 'hello\nworld' }, { sandboxRoot: dir })
  assert.equal(res.ok, true)
  const back = await fsRead.run({ path: 'notes/a.txt' }, { sandboxRoot: dir })
  assert.equal(back.ok, true)
  assert.equal(back.output, 'hello\nworld')
  assert.equal(readFileSync(join(dir, 'notes/a.txt'), 'utf-8'), 'hello\nworld')
})

test('fs.write rejects path escape without writing anything', async () => {
  const res = await fsWrite.run({ path: '../escape.txt', content: 'x' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /escape rejected/)
})

test('shell: allowlisted command runs', async () => {
  writeFileSync(join(dir, 'f.txt'), 'alpha\nbeta\n')
  const res = await shellTool.run({ command: 'cat f.txt' }, { sandboxRoot: dir })
  assert.equal(res.ok, true)
  assert.match(res.output, /alpha/)
})

test('shell: non-allowlisted command rejected before execution', async () => {
  const res = await shellTool.run({ command: 'rm f.txt' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /allowlist/)
})

test('lineDiff counts added and removed lines', () => {
  const d = lineDiff('a\nb', 'a\nc\nd')
  assert.equal(d.added, 2)
  assert.equal(d.removed, 1)
})

test('router: @prefix picks brain and strips prefix', () => {
  const r = routeTask('@kimi review this file', 'local')
  assert.equal(r.brainId, 'kimi')
  assert.equal(r.task, 'review this file')
})

test('router: default brain when no prefix', () => {
  const r = routeTask('just do it', 'local')
  assert.equal(r.brainId, 'local')
  assert.equal(r.task, 'just do it')
})
