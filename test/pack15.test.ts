// PACK 15: specialist tools

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { csvParse, csvFormat, xmlParse, htmlExtract, sqlFormat, templateRender, unitConvert, geoDistance, httpMock, checksumVerify, snippetSave, snippetSearch, textWrap } from '../src/tools/specialist.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p15-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('csv.parse: header + rows to JSON', async () => {
  const r = await csvParse.run({ text: 'name,age\nAlice,30\nBob,25' }, { sandboxRoot: dir })
  const rows = JSON.parse(r.output) as { name: string; age: string }[]
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.name, 'Alice')
  assert.equal(rows[1]!.age, '25')
})

test('csv.format: JSON to CSV roundtrip', async () => {
  const r = await csvFormat.run({ rows: [{ a: 1, b: 'x' }, { a: 2, b: 'y' }] }, { sandboxRoot: dir })
  assert.match(r.output, /a,b/)
  assert.match(r.output, /1,x/)
})

test('xml.parse: basic XML to JSON', async () => {
  const r = await xmlParse.run({ text: '<root><name>test</name><value>42</value><active>true</active></root>' }, { sandboxRoot: dir })
  const j = JSON.parse(r.output) as { root: { name: string; value: number; active: boolean } }
  assert.equal(j.root.name, 'test')
  assert.equal(j.root.value, '42')
  assert.equal(j.root.active, 'true')
})

test('html.extract: text, links, images, meta', async () => {
  const html = '<html><head><title>Test</title><meta name="desc" content="test page"></head><body><a href="/link1">Link 1</a><img src="img.png"><p>Hello world</p></body></html>'
  const text = await htmlExtract.run({ html, what: 'text' }, { sandboxRoot: dir })
  assert.match(text.output, /Hello world/)
  const links = await htmlExtract.run({ html, what: 'links' }, { sandboxRoot: dir })
  assert.match(links.output, /\/link1/)
  const imgs = await htmlExtract.run({ html, what: 'images' }, { sandboxRoot: dir })
  assert.match(imgs.output, /img\.png/)
  const meta = await htmlExtract.run({ html, what: 'meta' }, { sandboxRoot: dir })
  assert.match(meta.output, /title: Test/)
})

test('sql.format: keywords uppercase, clauses on lines', async () => {
  const r = await sqlFormat.run({ text: 'select id, name from users where age > 18 and city = \'Moscow\' order by name' }, { sandboxRoot: dir })
  assert.match(r.output, /SELECT/)
  assert.match(r.output, /FROM/)
  assert.match(r.output, /WHERE/)
  assert.match(r.output, /ORDER BY/)
})

test('template.render: variables and defaults', async () => {
  const r = await templateRender.run({ template: 'Hello {{name|friend}}, you are {{age|young}}!', vars: { name: 'Alice' } }, { sandboxRoot: dir })
  assert.match(r.output, /Hello Alice/)
  assert.match(r.output, /you are young/)
})

test('unit.convert: length, mass, temperature', async () => {
  const km = await unitConvert.run({ value: 5, from: 'km', to: 'mi' }, { sandboxRoot: dir })
  assert.match(km.output, /3\.10/)
  const kg = await unitConvert.run({ value: 100, from: 'kg', to: 'lb' }, { sandboxRoot: dir })
  assert.match(kg.output, /220\.46/)
  const temp = await unitConvert.run({ value: 100, from: 'c', to: 'f' }, { sandboxRoot: dir })
  assert.match(temp.output, /212/)
})

test('geo.distance: Moscow to SPb ≈ 635 km', async () => {
  const r = await geoDistance.run({ from: { lat: 55.7558, lon: 37.6173 }, to: { lat: 59.9311, lon: 30.3609 } }, { sandboxRoot: dir })
  const km = parseFloat(r.output)
  assert.ok(km > 600 && km < 700, `distance: ${km}`)
})

test('http.mock: start, verify, stop', async () => {
  const start = await httpMock.run({ response: { status: 200, body: '{"mock": true}' } }, { sandboxRoot: dir })
  assert.ok(start.ok)
  const url = start.output.split(': ')[1]
  assert.ok(url)
  const res = await fetch(url)
  assert.equal(res.status, 200)
  const j = await res.json() as { mock: boolean }
  assert.equal(j.mock, true)
  const stop = await httpMock.run({ action: 'stop' }, { sandboxRoot: dir })
  assert.ok(stop.ok)
})

test('checksum.verify: sha256 roundtrip', async () => {
  writeFileSync(join(dir, 'data.txt'), 'hello world')
  const hash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
  const r = await checksumVerify.run({ checksums: `${hash}  data.txt` }, { sandboxRoot: dir })
  assert.ok(r.ok)
  assert.match(r.output, /✓ data\.txt/)
})

test('snippet save + search', async () => {
  await snippetSave.run({ name: 'fibonacci', language: 'python', code: 'def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)' }, { sandboxRoot: dir })
  const search = await snippetSearch.run({ query: 'fib' }, { sandboxRoot: dir })
  assert.match(search.output, /fibonacci\.python/)
  assert.match(search.output, /def fib/)
})

test('text.wrap: respects column width', async () => {
  const long = 'word '.repeat(30).trim()
  const r = await textWrap.run({ text: long, width: 40 }, { sandboxRoot: dir })
  const lines = r.output.split('\n')
  assert.ok(lines.every((l) => l.length <= 41))
  assert.ok(lines.length > 1)
})
