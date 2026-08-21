// Tools Pack hermetic tests: fs.edit, code.search, fetch (stub), plan.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fsWrite, fsEdit } from '../src/tools/fs.js'
import { codeSearch } from '../src/tools/code.js'
import { fetchTool } from '../src/tools/fetch.js'
import { planWrite, planRead } from '../src/tools/plan.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-tools-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('fs.edit: replaces exactly and reports count', async () => {
  await fsWrite.run({ path: 'app.txt', content: 'alpha beta gamma beta' }, { sandboxRoot: dir })
  const one = await fsEdit.run({ path: 'app.txt', old: 'beta', new: 'BETA' }, { sandboxRoot: dir })
  assert.equal(one.ok, true)
  assert.match(one.output, /1 replacement/)
  await fsWrite.run({ path: 'many.txt', content: 'x beta, beta and beta' }, { sandboxRoot: dir })
  const all = await fsEdit.run({ path: 'many.txt', old: 'beta', new: 'y', all: true }, { sandboxRoot: dir })
  assert.match(all.output, /3 replacement/)
})

test('fs.edit: honest failure when old text missing — file untouched', async () => {
  await fsWrite.run({ path: 'f.txt', content: 'stable content' }, { sandboxRoot: dir })
  const res = await fsEdit.run({ path: 'f.txt', old: 'nope', new: 'x' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /not found/)
  const back = await fsWrite.run({ path: 'f.txt', content: 'stable content' }, { sandboxRoot: dir })
  assert.equal(back.ok, true)
})

test('fs.edit: missing file reported honestly', async () => {
  const res = await fsEdit.run({ path: 'ghost.txt', old: 'a', new: 'b' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /not found/)
})

test('fs.edit: escape attempts rejected', async () => {
  const res = await fsEdit.run({ path: '../out.txt', old: 'a', new: 'b' }, { sandboxRoot: dir })
  assert.equal(res.ok, false)
  assert.match(res.output, /escape rejected|failed/)
})

test('code.search: finds matches across nested files with file:line', async () => {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'main.ts'), 'const PORT = 11436\nexport {}\n')
  writeFileSync(join(dir, 'notes.md'), 'port is 11436 on llama-swap\n')
  const res = await codeSearch.run({ pattern: '11436' }, { sandboxRoot: dir })
  assert.equal(res.ok, true)
  assert.match(res.output, /src\/main\.ts:1/)
  assert.match(res.output, /notes\.md:1/)
})

test('code.search: invalid regex and empty results handled', async () => {
  const bad = await codeSearch.run({ pattern: '(' }, { sandboxRoot: dir })
  assert.equal(bad.ok, false)
  assert.match(bad.output, /invalid regex/)
  const miss = await codeSearch.run({ pattern: 'zzzznothing' }, { sandboxRoot: dir })
  assert.equal(miss.ok, true)
  assert.match(miss.output, /no matches/)
})

test('fetch: reads text via stub server, guards schemes and types', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/api') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ answer: 42 }))
    } else if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><script>bad()</script><body><h1>Title</h1><p>Hello world</p></body></html>')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const ctx = { sandboxRoot: dir }

  const json = await fetchTool.run({ url: `${base}/api` }, ctx)
  assert.equal(json.ok, true)
  assert.match(json.output, /42/)

  const page = await fetchTool.run({ url: `${base}/page` }, ctx)
  assert.equal(page.ok, true)
  assert.match(page.output, /Hello world/)
  assert.ok(!page.output.includes('bad()'), 'scripts must be stripped')

  const miss = await fetchTool.run({ url: `${base}/nope` }, ctx)
  assert.equal(miss.ok, false)

  const evil = await fetchTool.run({ url: 'file:///etc/passwd' }, ctx)
  assert.equal(evil.ok, false)
  assert.match(evil.output, /not allowed|invalid/)

  await new Promise<void>((r) => server.close(() => r()))
})

test('plan: write, read, mark_done roundtrip', async () => {
  const ctx = { sandboxRoot: dir }
  const w = await planWrite.run({ steps: ['find the file', 'edit it', 'verify'] }, ctx)
  assert.equal(w.ok, true)
  const r1 = await planRead.run({}, ctx)
  assert.match(r1.output, /1\. \[ \] find the file/)
  const m = await planWrite.run({ mark_done: 2 }, ctx)
  assert.equal(m.ok, true)
  const r2 = await planRead.run({}, ctx)
  assert.match(r2.output, /2\. \[✓\] edit it/)
  assert.match(r2.output, /3\. \[ \] verify/)
  const bad = await planWrite.run({ mark_done: 9 }, ctx)
  assert.equal(bad.ok, false)
})
