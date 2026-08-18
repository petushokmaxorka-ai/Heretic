// Chat pack hermetic tests: ddg parsing (fixture), searxng (stub server),
// thinking map, runChat with injected search — zero network.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseDdgLite, webSearch } from '../src/tools/search.js'
import { thinkingProfile, isThinkingLevel } from '../src/thinking.js'
import { runChat } from '../src/engine/chat.js'
import { EchoBrain } from '../src/brains/echo.js'
import type { ChatMessage } from '../src/protocol/types.js'
import type { SearchResult } from '../src/tools/search.js'

const DDG_FIXTURE = `
<html><body>
<table>
<tr><td><a rel="nofollow" href="https://en.wikipedia.org/wiki/LLVM" class="result-link">LLVM - Wikipedia</a></td></tr>
<tr><td class="result-snippet">The LLVM Compiler Infrastructure &amp; project</td></tr>
<tr><td><a rel="nofollow" href="https://llvm.org/" class="result-link">The LLVM Compiler Infrastructure Project</a></td></tr>
<tr><td class="result-snippet">Welcome to LLVM&gt; official site</td></tr>
</table>
</body></html>`

test('search: parses ddg lite fixture into results', () => {
  const r = parseDdgLite(DDG_FIXTURE)
  assert.equal(r.length, 2)
  assert.equal(r[0]!.title, 'LLVM - Wikipedia')
  assert.equal(r[0]!.url, 'https://en.wikipedia.org/wiki/LLVM')
  assert.equal(r[0]!.snippet, 'The LLVM Compiler Infrastructure & project')
  assert.equal(r[1]!.title, 'The LLVM Compiler Infrastructure Project')
  assert.equal(r[1]!.snippet, 'Welcome to LLVM> official site')
})

test('search: searxng json path via stub server', async () => {
  const server = createServer((req, res) => {
    if (req.url?.includes('/search?') && req.url.includes('format=json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results: [{ title: 'Ans', url: 'https://x.test/a', content: 'snippet here' }] }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const r = await webSearch('test', { searxng: base })
  assert.equal(r.length, 1)
  assert.equal(r[0]!.title, 'Ans')
  await new Promise<void>((r) => server.close(() => r()))
})

test('thinking: profile map is sane', () => {
  assert.equal(thinkingProfile('low').maxTokens, 512)
  assert.equal(thinkingProfile('max').maxTokens, 4096)
  assert.ok(thinkingProfile('high').directive.length > 0)
  assert.equal(thinkingProfile('bogus' as never), thinkingProfile('mid'))
  assert.equal(isThinkingLevel('low'), true)
  assert.equal(isThinkingLevel('ultra'), false)
})

test('runChat: web results injected, status reported, answer returned', async () => {
  const brain = new EchoBrain(['the answer is 42'])
  const statuses: string[] = []
  const fakeResults: SearchResult[] = [
    { title: 'Deep Thought', url: 'https://deep.test', snippet: 'the answer' }
  ]
  const history: ChatMessage[] = [{ role: 'user', content: 'what is the answer?' }]
  const r = await runChat({
    history,
    brain,
    thinking: 'high',
    web: true,
    searchFn: async () => fakeResults,
    onStatus: (l) => statuses.push(l)
  })
  assert.equal(r.answer, 'the answer is 42')
  assert.equal(r.sources.length, 1)
  assert.ok(statuses.some((s) => s.includes('1 results')))
})

test('runChat: search failure degrades gracefully', async () => {
  const brain = new EchoBrain(['still answering'])
  const r = await runChat({
    history: [{ role: 'user', content: 'q' }],
    brain,
    web: true,
    searchFn: async () => {
      throw new Error('network down')
    },
    onStatus: () => {}
  })
  assert.equal(r.answer, 'still answering')
  assert.equal(r.sources.length, 0)
})
