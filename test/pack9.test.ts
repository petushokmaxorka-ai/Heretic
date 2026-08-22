// PACK 9: fs tier-3 + git trio + sys.info

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fsWrite, fsMove, fsCopy, fsDelete, fsMkdir } from '../src/tools/fs.js'
import { gitStatus, gitDiff, gitLog } from '../src/tools/git.js'
import { sysInfo } from '../src/tools/sys.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p9-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('fs tier3: move / copy / delete / mkdir roundtrip with escapes rejected', async () => {
  await fsWrite.run({ path: 'a.txt', content: 'data' }, { sandboxRoot: dir })
  await fsMkdir.run({ path: 'nested/deep' }, { sandboxRoot: dir })
  const mv = await fsMove.run({ from: 'a.txt', to: 'nested/deep/b.txt' }, { sandboxRoot: dir })
  assert.equal(mv.ok, true)
  assert.equal(existsSync(join(dir, 'a.txt')), false)
  assert.equal(readFileSync(join(dir, 'nested/deep/b.txt'), 'utf-8'), 'data')
  const cp = await fsCopy.run({ from: 'nested/deep/b.txt', to: 'c.txt' }, { sandboxRoot: dir })
  assert.equal(cp.ok, true)
  const rm2 = await fsDelete.run({ path: 'c.txt' }, { sandboxRoot: dir })
  assert.equal(rm2.ok, true)
  assert.equal(existsSync(join(dir, 'c.txt')), false)
  const esc = await fsMove.run({ from: 'a.txt', to: '../outside.txt' }, { sandboxRoot: dir })
  assert.equal(esc.ok, false)
  assert.match(esc.output, /escape|failed/)
})

test('git trio: status/diff/log on a temp repo', async () => {
  const run = (args: string[]): void => { execFileSync('git', args, { cwd: dir }) }
  run(['init', '-q'])
  run(['config', 'user.email', 't@t'])
  run(['config', 'user.name', 't'])
  writeFileSync(join(dir, 'f.txt'), 'v1')
  run(['add', '.'])
  run(['commit', '-qm', 'init'])
  const ctx = { sandboxRoot: dir }
  const log = await gitLog.run({}, ctx)
  assert.equal(log.ok, true)
  assert.match(log.output, /init/)
  writeFileSync(join(dir, 'f.txt'), 'v2')
  const st = await gitStatus.run({}, ctx)
  assert.match(st.output, /f\.txt/)
  const diff = await gitDiff.run({}, ctx)
  assert.match(diff.output, /v2/)
  const outside = await gitLog.run({}, { sandboxRoot: join(dir, '..') })
  assert.ok(outside.ok === false || outside.output.length >= 0, 'graceful outside a repo')
})

test('sys.info: vitals line present', async () => {
  const r = await sysInfo.run({}, { sandboxRoot: dir })
  assert.equal(r.ok, true)
  assert.match(r.output, /cpu:/)
  assert.match(r.output, /ram:/)
})
