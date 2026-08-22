// PACK 12: net tools, proc/text, crypto extras, info tools, mode.get

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { httpRequest, dnsLookup, portCheck } from '../src/tools/net.js'
import { processList, textDiff, jsonFormat } from '../src/tools/proc-text.js'
import { cryptoEncrypt, cryptoDecrypt, cryptoRandom, hashFile } from '../src/tools/crypto-extra.js'
import { wikiSearch } from '../src/tools/info.js'
import { modeGet } from '../src/tools/organs-extra.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p12-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('http.request: GET and POST via stub, scheme guarded', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ echo: JSON.parse(body).msg }))
      })
    } else {
      res.writeHead(200)
      res.end('hello from stub')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const get = await httpRequest.run({ url: `${base}/` }, { sandboxRoot: dir })
    assert.match(get.output, /hello from stub/)
    const post = await httpRequest.run({ url: `${base}/api`, method: 'POST', body: { msg: 'Привет' }, json: true }, { sandboxRoot: dir })
    assert.match(post.output, /Привет/)
    const evil = await httpRequest.run({ url: 'file:///etc/passwd' }, { sandboxRoot: dir })
    assert.equal(evil.ok, false)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('dns.lookup: localhost resolves; port.check: stub port open', async () => {
  const dns = await dnsLookup.run({ host: 'localhost' }, { sandboxRoot: dir })
  assert.equal(dns.ok, true)
  assert.match(dns.output, /127\.0\.0\.1/)

  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    const check = await portCheck.run({ ports: [port, 1] }, { sandboxRoot: dir })
    assert.match(check.output, new RegExp(`✓ open :${port}`))
    assert.match(check.output, /✗ closed :1\b/)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('process.list: header + rows; text.diff counts; json.format validates', async () => {
  const ps = await processList.run({ limit: 5 }, { sandboxRoot: dir })
  assert.match(ps.output, /USER.*%CPU/)
  const diff = await textDiff.run({ a: 'line1\nline2', b: 'line1\nchanged\nnew' }, { sandboxRoot: dir })
  assert.match(diff.output, /\+\d+ \/ -\d+ lines/)
  const json = await jsonFormat.run({ text: '{"b":1,"a":2}' }, { sandboxRoot: dir })
  assert.match(json.output, /"a": 2/)
  const bad = await jsonFormat.run({ text: '{broken' }, { sandboxRoot: dir })
  assert.equal(bad.ok, false)
})

test('crypto: AES roundtrip, random bounds, hash.file known value', async () => {
  const enc = await cryptoEncrypt.run({ text: 'секрет Принципала', key: 'пароль' }, { sandboxRoot: dir })
  assert.equal(enc.ok, true)
  const dec = await cryptoDecrypt.run({ data: enc.output, key: 'пароль' }, { sandboxRoot: dir })
  assert.equal(dec.output, 'секрет Принципала')
  const wrong = await cryptoDecrypt.run({ data: enc.output, key: 'не-пароль' }, { sandboxRoot: dir })
  assert.equal(wrong.ok, false)
  const rand = await cryptoRandom.run({ min: 1, max: 10 }, { sandboxRoot: dir })
  const n = Number(rand.output)
  assert.ok(n >= 1 && n <= 10)
  writeFileSync(join(dir, 'f.txt'), 'abc')
  const hash = await hashFile.run({ path: 'f.txt' }, { sandboxRoot: dir })
  assert.equal(hash.output, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('wiki.search: keyless, snippets returned', async () => {
  const r = await wikiSearch.run({ query: 'Heretici', language: 'en', limit: 3 }, { sandboxRoot: dir })
  assert.equal(r.ok, true)
  assert.ok(r.output.includes('[') || r.output.includes('no results'))
})

test('mode.get: honest on non-host machines', async () => {
  const r = await modeGet.run({}, { sandboxRoot: dir })
  assert.ok(r.ok === true || r.ok === false, 'never crashes')
})
