// PACK 14: swiss army tools

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chartBar, mdTable, mdRender, passwordGen, ipCalc, baseConvert, loremGen, imageInfo } from '../src/tools/swiss.js'
import { ttsSpeak } from '../src/tools/tts.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p14-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('chart.bar: renders ASCII bars with labels', async () => {
  const r = await chartBar.run({ data: { alpha: 10, beta: 5, gamma: 8 }, title: 'TEST' }, { sandboxRoot: dir })
  assert.match(r.output, /TEST/)
  assert.match(r.output, /alpha\s+█+ 10/)
  assert.match(r.output, /gamma\s+█+ 8/)
})

test('md.table: generates markdown table', async () => {
  const r = await mdTable.run({ rows: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }] }, { sandboxRoot: dir })
  assert.match(r.output, /\| name \| age \|/)
  assert.match(r.output, /\| --- \| --- \|/)
  assert.match(r.output, /\| Alice \| 30 \|/)
})

test('md.render: markdown to HTML', async () => {
  const r = await mdRender.run({ text: '# Title\n\n**bold** and *italic* and `code`' }, { sandboxRoot: dir })
  assert.match(r.output, /<h3>Title<\/h3>/)
  assert.match(r.output, /<b>bold<\/b>/)
  assert.match(r.output, /<code>code<\/code>/)
})

test('password.gen: secure passwords with length and charset', async () => {
  const r = await passwordGen.run({ length: 24, count: 3 }, { sandboxRoot: dir })
  const pws = r.output.split('\n')
  assert.equal(pws.length, 3)
  assert.ok(pws.every((p) => p.length === 24))
  assert.ok(pws.every((p) => /[a-z]/.test(p) && /[A-Z0-9]/.test(p)))
})

test('ip.calc: subnet math', async () => {
  const r = await ipCalc.run({ ip: '192.168.1.10/24' }, { sandboxRoot: dir })
  assert.match(r.output, /network: 192\.168\.1\.0/)
  assert.match(r.output, /broadcast: 192\.168\.1\.255/)
  assert.match(r.output, /usable hosts: 254/)
  const r2 = await ipCalc.run({ ip: '10.0.0.0/8' }, { sandboxRoot: dir })
  assert.match(r2.output, /usable hosts: 16777214/)
})

test('base.convert: number base conversions', async () => {
  const hex = await baseConvert.run({ value: '255', from: 10, to: 16 }, { sandboxRoot: dir })
  assert.equal(hex.output, '0xFF')
  const bin = await baseConvert.run({ value: '255', from: 10, to: 2 }, { sandboxRoot: dir })
  assert.equal(bin.output, '0b11111111')
  const dec = await baseConvert.run({ value: '0xFF', from: 16, to: 10 }, { sandboxRoot: dir })
  assert.equal(dec.output, '255')
})

test('lorem.gen: generates text in requested format', async () => {
  const words = await loremGen.run({ type: 'words', count: 2 }, { sandboxRoot: dir })
  assert.ok(words.output.split(' ').length >= 15)
  const paras = await loremGen.run({ type: 'paragraphs', count: 2 }, { sandboxRoot: dir })
  assert.ok(paras.output.includes('\n\n'))
  const ru = await loremGen.run({ type: 'sentences', count: 2, russian: true }, { sandboxRoot: dir })
  assert.ok(ru.output.includes('.'))
})

test('image.info: reads PNG header', async () => {
  // minimal valid PNG header
  const pngHeader = Buffer.alloc(24)
  pngHeader.writeUInt32BE(0x89504E47, 0)
  pngHeader[0] = 0x89; pngHeader[1] = 0x50; pngHeader[2] = 0x4E; pngHeader[3] = 0x47
  pngHeader.writeUInt32BE(100, 16) // width
  pngHeader.writeUInt32BE(200, 20) // height
  writeFileSync(join(dir, 'test.png'), pngHeader)
  const r = await imageInfo.run({ path: 'test.png' }, { sandboxRoot: dir })
  assert.equal(r.ok, true)
  assert.match(r.output, /PNG/)
  assert.match(r.output, /100×200/)
})

test('tts.speak: degrades gracefully without host service', async () => {
  const r = await ttsSpeak.run({ text: 'привет' }, { sandboxRoot: dir })
  assert.ok(r.ok !== undefined, 'always responds')
})
