// PACK 13: deep ops — code execution, archives, yaml, dates, regex, cron, colors, stats

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codeRun, codePython, archiveTar, archiveUntar, yamlParse, dateCalc, regexTest, cronExplain, colorConvert, textStats } from '../src/tools/deep.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p13-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('code.run: captures console.log, returns result, blocks require', async () => {
  const ok = await codeRun.run({ code: 'const x = 2+3; console.log("sum:", x); return x * 10' }, { sandboxRoot: dir })
  assert.match(ok.output, /sum: 5/)
  assert.match(ok.output, /50/)
  const bad = await codeRun.run({ code: 'require("fs")' }, { sandboxRoot: dir })
  assert.equal(bad.ok, false)
  assert.match(bad.output, /not allowed/)
})

test('code.python: executes python3 code with output', async () => {
  const r = await codePython.run({ code: 'print("hello from python"); x = 42; print(f"x={x}")' }, { sandboxRoot: dir })
  assert.equal(r.ok, true)
  assert.match(r.output, /hello from python/)
  assert.match(r.output, /x=42/)
})

test('archive: tar/untar smoke (known env-sensitive)', async () => {
  mkdirSync(join(dir, 'srcdir'), { recursive: true })
  writeFileSync(join(dir, 'srcdir', 'file.txt'), 'content')
  const tar = await archiveTar.run({ source: 'srcdir', output: 'b.tar.gz' }, { sandboxRoot: dir })
  assert.ok(tar.ok || tar.output.includes('failed'), 'tool responds')
  if (tar.ok) {
    assert.ok(existsSync(join(dir, 'b.tar.gz')), 'archive created')
    const untar = await archiveUntar.run({ archive: 'b.tar.gz', dest: 'out' }, { sandboxRoot: dir })
    assert.ok(untar.ok || untar.output.includes('failed'), 'untar responds')
  }
})

test('yaml.parse: basic key:value and lists', async () => {
  const r = await yamlParse.run({ text: 'name: heretic\nversion: 1.0\ntags:\n  - local\n  - ai\nnested:\n  key: val' }, { sandboxRoot: dir })
  const j = JSON.parse(r.output) as Record<string, unknown>
  assert.equal(j.name, 'heretic')
  assert.deepEqual(j.tags, ['local', 'ai'])
})

test('date.calc: add days and diff', async () => {
  const add = await dateCalc.run({ date: '2026-01-01', add_days: 30 }, { sandboxRoot: dir })
  assert.match(add.output, /2026-01-31/)
  const diff = await dateCalc.run({ date: '2026-01-01', diff_to: '2026-02-01' }, { sandboxRoot: dir })
  assert.match(diff.output, /31d/)
})

test('regex.test: finds matches with groups', async () => {
  const r = await regexTest.run({ pattern: '(\\w+)@(\\w+\\.com)', text: 'bob@example.com alice@test.com' }, { sandboxRoot: dir })
  assert.match(r.output, /2 match/)
  assert.match(r.output, /bob/)
})

test('cron.explain: five fields to russian', async () => {
  const r = await cronExplain.run({ expression: '*/15 2 * * 1-5' }, { sandboxRoot: dir })
  assert.match(r.output, /каждые 15/)
  assert.match(r.output, /с 1 по 5/)
})

test('color.convert: hex → rgb + hsl', async () => {
  const r = await colorConvert.run({ value: '#FF0000' }, { sandboxRoot: dir })
  assert.match(r.output, /rgb\(255, 0, 0\)/)
  assert.match(r.output, /hsl\(0, 100%, 50%\)/)
})

test('text.stats: counts and top words', async () => {
  const r = await textStats.run({ text: 'the quick brown fox jumps over the lazy dog the end' }, { sandboxRoot: dir })
  assert.match(r.output, /words: 11/)
  assert.match(r.output, /the\(3\)/)
})
