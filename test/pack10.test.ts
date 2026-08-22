// PACK 10: util tools + MCP client against a stub stdio server.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { timeNow, cryptoHash, cryptoUuid, encodeBase64, fsGlob, randomDice } from '../src/tools/util.js'
import { connectMcp } from '../src/mcp/manager.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p10-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('time.now: UTC + timezone', async () => {
  const r = await timeNow.run({}, { sandboxRoot: dir })
  assert.match(r.output, /utc: \d{4}-\d{2}-\d{2}T/)
  const tz = await timeNow.run({ tz: 'Europe/Moscow' }, { sandboxRoot: dir })
  assert.match(tz.output, /Europe\/Moscow/)
  const bad = await timeNow.run({ tz: 'Mars/Olympus' }, { sandboxRoot: dir })
  assert.equal(bad.ok, false)
})

test('crypto.hash: known sha256 of "abc"', async () => {
  const r = await cryptoHash.run({ text: 'abc' }, { sandboxRoot: dir })
  assert.equal(r.output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const bad = await cryptoHash.run({ algo: 'md4', text: 'x' }, { sandboxRoot: dir })
  assert.equal(bad.ok, false)
})

test('crypto.uuid + base64 roundtrip', async () => {
  const u = await cryptoUuid.run({}, { sandboxRoot: dir })
  assert.match(u.output, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  const enc = await encodeBase64.run({ text: 'Привет, Anathemetron!' }, { sandboxRoot: dir })
  const dec = await encodeBase64.run({ text: enc.output, decode: true }, { sandboxRoot: dir })
  assert.equal(dec.output, 'Привет, Anathemetron!')
})

test('fs.glob: ** and segment patterns', async () => {
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true })
  writeFileSync(join(dir, 'src', 'main.ts'), 'x')
  writeFileSync(join(dir, 'src', 'deep', 'util.ts'), 'x')
  writeFileSync(join(dir, 'notes.md'), 'x')
  const all = await fsGlob.run({ pattern: 'src/**/*.ts' }, { sandboxRoot: dir })
  assert.match(all.output, /src\/main\.ts/)
  assert.match(all.output, /src\/deep\/util\.ts/)
  const one = await fsGlob.run({ pattern: '*.md' }, { sandboxRoot: dir })
  assert.equal(one.output, 'notes.md')
})

test('random.dice: bounds and format', async () => {
  const r = await randomDice.run({ count: 3, sides: 6, modifier: 2 }, { sandboxRoot: dir })
  assert.match(r.output, /3d6\+2: \[\d+, \d+, \d+\] \+2 = \d+/)
  const total = Number(r.output.split('= ')[1])
  assert.ok(total >= 5 && total <= 20, `total in bounds: ${total}`)
})

const STUB = `
const readline = require('node:readline')
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1.0' } } })
  } else if (m.method === 'notifications/initialized') {
    /* notification — no reply */
  } else if (m.method === 'tools/list') {
    out({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'echo', description: 'echoes arguments', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'boom', description: 'always errors', inputSchema: { type: 'object' } }
    ] } })
  } else if (m.method === 'tools/call') {
    if (m.params.name === 'boom') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'exploded' }], isError: true } })
    else out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + JSON.stringify(m.params.arguments) }] } })
  }
})
`

test('MCP: connect stub server, list tools, call, error shape, dead-server degrade', async () => {
  const stubPath = join(dir, 'stub-mcp.cjs')
  writeFileSync(stubPath, STUB)
  const cfgPath = join(dir, 'mcp.json')
  writeFileSync(
    cfgPath,
    JSON.stringify({
      servers: {
        stub: { command: process.execPath, args: [stubPath] },
        dead: { command: '/nonexistent/binary/that/never/exists', args: [] }
      }
    })
  )
  const fleet = await connectMcp(cfgPath)
  try {
    assert.deepEqual(fleet.errors.map((e) => e.split(':')[0]), ['dead'], 'dead server reported, fleet alive')
    const names = fleet.tools.map((t) => t.name)
    assert.deepEqual(names.sort(), ['mcp.stub.boom', 'mcp.stub.echo'])
    const echo = fleet.tools.find((t) => t.name === 'mcp.stub.echo')!
    assert.equal(echo.mutating, false, 'readOnlyHint respected')
    const r = await echo.run({ hello: 'world' }, { sandboxRoot: dir })
    assert.equal(r.ok, true)
    assert.match(r.output, /echo: .*world/)
    const boom = fleet.tools.find((t) => t.name === 'mcp.stub.boom')!
    assert.equal(boom.mutating, true, 'unknown tools gated')
    const bad = await boom.run({}, { sandboxRoot: dir })
    assert.equal(bad.ok, false)
    assert.equal(bad.output, 'exploded')
  } finally {
    fleet.clients.forEach((c) => c.stop())
  }
})
