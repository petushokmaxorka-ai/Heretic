// Contract test: probeUrl against a stub OpenAI-compatible /v1/models.
// This is the shape llama-swap / ollama / lmstudio actually serve.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { probeUrl } from '../src/discovery.js'

test('probeUrl: recognizes a stub OpenAI runtime', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'Qwable-Genesis' }, { id: 'Qwythos-Narrator' }] }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}/`

  const hit = await probeUrl('stub', baseUrl, 2000)
  assert.notEqual(hit, null)
  assert.equal(hit!.name, 'stub')
  assert.deepEqual(hit!.models, ['Qwable-Genesis', 'Qwythos-Narrator'])

  const miss = await probeUrl('stub', `http://127.0.0.1:1/`, 300)
  assert.equal(miss, null)

  await new Promise<void>((r) => server.close(() => r()))
})
