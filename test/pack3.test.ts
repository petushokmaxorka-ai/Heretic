// PACK 3 hermetic tests: resident parsing, llama.status swap-safety,
// organs graceful degradation — all against stub servers, zero GPU.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseResidents, pickResident, llamaStatusTool, llamaStatus } from '../src/tools/llama.js'
import { memoriaQuery, servicesHealth } from '../src/tools/organs.js'

function stub(routes: Record<string, unknown | ((req: { url?: string; method?: string }) => unknown)>): Promise<{
  base: string
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const key = Object.keys(routes).find((k) => (req.url ?? '').startsWith(k))
      const val = key ? routes[key] : null
      if (val === null) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(typeof val === 'function' ? val(req) : val))
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.()
            server.close(() => r())
          })
      })
    })
  })
}

test('parseResidents: llama-swap state map marks loaded models', () => {
  const known = ['Qwable-Genesis', 'Qwythos-Narrator', 'Qwythos-9B-v2']
  const r = parseResidents({ state: { 'Qwable-Genesis': 'loaded', 'Qwythos-Narrator': 'loaded', 'Qwythos-9B-v2': 'idle' } }, known)
  assert.notEqual(r, null)
  assert.equal(r!.has('Qwable-Genesis'), true)
  assert.equal(r!.has('Qwythos-9B-v2'), false)
})

test('parseResidents: loaded-array shapes tolerated', () => {
  const r = parseResidents({ loaded: ['model-a', 'model-b'], current: 'model-a' }, [])
  assert.notEqual(r, null)
  assert.equal(r!.has('model-b'), true)
})

test('pickResident: prefers resident, falls back honestly', () => {
  const residents = new Set(['Qwythos-Narrator'])
  assert.deepEqual(pickResident(['Qwable-Genesis', 'Qwythos-Narrator'], residents), { model: 'Qwythos-Narrator', resident: true })
  const fallback = pickResident(['A', 'B'], null)
  assert.equal(fallback.model, 'A')
  assert.equal(fallback.resident, null)
})

test('llama.status tool: marks residency, GET-only (swap-safe)', async () => {
  const methods: string[] = []
  const s = await stub({
    '/v1/models': () => {
      methods.push('GET:/v1/models')
      return { data: [{ id: 'Qwable-Genesis' }, { id: 'Qwythos-9B-v2' }] }
    },
    '/health': () => {
      methods.push('GET:/health')
      return { state: { 'Qwable-Genesis': 'loaded' } }
    }
  })
  try {
    const res = await llamaStatusTool.run({ url: s.base }, { sandboxRoot: '/tmp' })
    assert.equal(res.ok, true)
    assert.match(res.output, /◉ Qwable-Genesis/)
    assert.match(res.output, /○ Qwythos-9B-v2/)
    assert.ok(methods.every((m) => m.startsWith('GET:')), 'must be GET-only — swaps impossible')
  } finally {
    await s.close()
  }
})

test('llamaStatus: health absent → residency unknown, never fails', async () => {
  const s = await stub({
    '/v1/models': { data: [{ id: 'm1' }] }
  })
  try {
    const st = await llamaStatus(s.base)
    assert.equal(st.models[0]!.resident, null)
  } finally {
    await s.close()
  }
})

test('memoria.query: parses results and degrades gracefully', async () => {
  const s = await stub({
    '/search': { results: [{ text: 'the user prefers teal' }, { text: 'port 11436' }] }
  })
  try {
    const ok = await memoriaQuery.run({ query: 'colors', base: s.base }, { sandboxRoot: '/tmp' })
    assert.equal(ok.ok, true)
    assert.match(ok.output, /teal/)
  } finally {
    await s.close()
  }
  const dead = await memoriaQuery.run({ query: 'x', base: 'http://127.0.0.1:1/' }, { sandboxRoot: '/tmp' })
  assert.equal(dead.ok, false)
  assert.match(dead.output, /unreachable|unavailable/)

  const evil = await memoriaQuery.run({ query: 'x', base: 'file:///etc' }, { sandboxRoot: '/tmp' })
  assert.equal(evil.ok, false)
})

test('services.health: formats fleet and degrades', async () => {
  const s = await stub({
    '/api/health/services': { services: [{ name: 'llama-swap', status: 'active', active: true }, { name: 'praescientia', status: 'failed', active: false }] }
  })
  try {
    const res = await servicesHealth.run({ base: s.base }, { sandboxRoot: '/tmp' })
    assert.equal(res.ok, true)
    assert.match(res.output, /✓ llama-swap/)
    assert.match(res.output, /✗ praescientia/)
  } finally {
    await s.close()
  }
  const dead = await servicesHealth.run({ base: 'http://127.0.0.1:1/' }, { sandboxRoot: '/tmp' })
  assert.equal(dead.ok, false)
  assert.match(dead.output, /unreachable/)
})
