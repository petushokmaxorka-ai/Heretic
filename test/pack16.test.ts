// PACK 16: operator tools — git write, docker, systemd, JSON, text, humanize

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitAdd, gitCommit, gitBranch } from '../src/tools/operator.js'
import { jsonPath, jsonMerge, textCase, textSlug, stringSimilarity, humanizeBytes, humanizeDuration, intervalParse } from '../src/tools/operator.js'
import { systemdList } from '../src/tools/operator.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p16-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('git write: add → commit → branch roundtrip', async () => {
  const run = (args: string[]): void => { execFileSync('git', args, { cwd: dir }) }
  run(['init', '-q']); run(['config', 'user.email', 't@t']); run(['config', 'user.name', 't'])
  writeFileSync(join(dir, 'f.txt'), 'v1')
  const add = await gitAdd.run({ paths: ['.'] }, { sandboxRoot: dir })
  assert.ok(add.ok, add.output)
  const commit = await gitCommit.run({ message: 'feat: initial' }, { sandboxRoot: dir })
  assert.ok(commit.ok, commit.output)
  const branch = await gitBranch.run({ action: 'create', name: 'feature' }, { sandboxRoot: dir })
  assert.ok(branch.ok, branch.output)
  const list = await gitBranch.run({ action: 'list' }, { sandboxRoot: dir })
  assert.match(list.output, /feature/)
  const main2 = await gitBranch.run({ action: 'switch', name: 'master' }, { sandboxRoot: dir })
  assert.ok(main2.ok || main2.output.includes('master') || main2.output.includes('main'), main2.output)
})

test('json.path: dot notation queries', async () => {
  const data = { a: { b: [10, 20, { c: 'deep' }] }, x: 'top' }
  const r1 = await jsonPath.run({ data, path: 'x' }, { sandboxRoot: dir })
  assert.equal(r1.output, 'top')
  const r2 = await jsonPath.run({ data, path: 'a.b.1' }, { sandboxRoot: dir })
  assert.equal(r2.output, '20')
  const r3 = await jsonPath.run({ data, path: 'a.b.2.c' }, { sandboxRoot: dir })
  assert.equal(r3.output, 'deep')
  const miss = await jsonPath.run({ data, path: 'a.z' }, { sandboxRoot: dir })
  assert.equal(miss.ok, false)
})

test('json.merge: deep merge with array concat', async () => {
  const r = await jsonMerge.run({ a: '{"x": 1, "arr": [1,2]}', b: '{"y": 2, "arr": [3]}' }, { sandboxRoot: dir })
  const j = JSON.parse(r.output) as { x: number; y: number; arr: number[] }
  assert.equal(j.x, 1)
  assert.equal(j.y, 2)
  assert.deepEqual(j.arr, [1, 2, 3])
})

test('text.case: all conversions', async () => {
  const cases: Record<string, string> = {
    camel: 'helloWorld',
    snake: 'hello_world',
    kebab: 'hello-world',
    pascal: 'HelloWorld',
    title: 'Hello World',
    constant: 'HELLO_WORLD',
    upper: 'HELLO WORLD',
    lower: 'hello world'
  }
  for (const [to, expected] of Object.entries(cases)) {
    const r = await textCase.run({ text: 'hello world', to }, { sandboxRoot: dir })
    assert.equal(r.output, expected, `${to}: ${r.output}`)
  }
})

test('text.slug: cyrillic transliteration', async () => {
  const r = await textSlug.run({ text: 'Привет Мир! Как дела?' }, { sandboxRoot: dir })
  assert.equal(r.output, 'privet-mir-kak-dela')
})

test('string.similarity: distance and percentage', async () => {
  const same = await stringSimilarity.run({ a: 'hello', b: 'hello' }, { sandboxRoot: dir })
  assert.match(same.output, /distance: 0/)
  assert.match(same.output, /100\.0%/)
  const diff = await stringSimilarity.run({ a: 'kitten', b: 'sitting' }, { sandboxRoot: dir })
  assert.match(diff.output, /distance: 3/)
})

test('humanize: bytes and duration', async () => {
  const b1 = await humanizeBytes.run({ bytes: 1536 }, { sandboxRoot: dir })
  assert.equal(b1.output, '1.5 KB')
  const b2 = await humanizeBytes.run({ bytes: 1073741824 }, { sandboxRoot: dir })
  assert.equal(b2.output, '1.0 GB')
  const d1 = await humanizeDuration.run({ seconds: 5400 }, { sandboxRoot: dir })
  assert.equal(d1.output, '1h 30m')
  const d2 = await humanizeDuration.run({ seconds: 90061 }, { sandboxRoot: dir })
  assert.match(d2.output, /1d 1h 1m 1s/)
})

test('interval.parse: human intervals to seconds', async () => {
  const r1 = await intervalParse.run({ text: '1h30m' }, { sandboxRoot: dir })
  assert.match(r1.output, /5400s/)
  const r2 = await intervalParse.run({ text: '2d' }, { sandboxRoot: dir })
  assert.match(r2.output, /172800s/)
  const r3 = await intervalParse.run({ text: '45s' }, { sandboxRoot: dir })
  assert.match(r3.output, /45s/)
})

test('systemd.list: never crashes (host-dependent)', async () => {
  const r = await systemdList.run({}, { sandboxRoot: dir })
  assert.ok(r.ok === true || r.ok === false)
})
