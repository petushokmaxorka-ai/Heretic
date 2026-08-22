// PACK 5 hermetic tests: persona reaches system prompts, multimodal
// messages reach the backend in OpenAI shape.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runAgent } from '../src/engine/agent.js'
import { runChat } from '../src/engine/chat.js'
import { EchoBrain } from '../src/brains/echo.js'
import { OpenAIBrain } from '../src/brains/openai.js'
import { autoAllow } from '../src/engine/policy.js'
import { fsTools } from '../src/tools/fs.js'
import { Sandbox } from '../src/tools/sandbox.js'
import type { Brain, ChatMessage } from '../src/protocol/types.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p5-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function recorder(): { brain: Brain; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = []
  return {
    seen,
    brain: {
      id: 'rec',
      label: 'rec',
      chat: async (m: ChatMessage[]): Promise<string> => {
        seen.push(m)
        return 'done'
      }
    }
  }
}

test('persona reaches the chat system prompt', async () => {
  const rec = recorder()
  await runChat({
    history: [{ role: 'user', content: 'привет' }],
    brain: rec.brain,
    persona: 'Говори по-русски, обращайся на «ты».'
  })
  assert.match(rec.seen[0]![0]!.content, /Говори по-русски/)
})

test('persona reaches the agent system prompt', async () => {
  const rec = recorder()
  await runAgent('task', {
    brain: rec.brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow,
    persona: 'ANSWER IN RHYME'
  })
  assert.match(rec.seen[0]![0]!.content, /ANSWER IN RHYME/)
})

test('images attach to the last user message only', async () => {
  const rec = recorder()
  await runChat({
    history: [
      { role: 'user', content: 'первый вопрос' },
      { role: 'assistant', content: 'ответ' },
      { role: 'user', content: 'что на картинке?' }
    ],
    brain: rec.brain,
    images: ['data:image/png;base64,AAAA']
  })
  const history = rec.seen[0]!.slice(1)
  assert.equal(history[0]!.images, undefined)
  assert.equal(history[2]!.images?.length, 1)
  assert.match(history[2]!.images![0]!, /^data:image\/png/)
})

test('contract: OpenAIBrain renders multimodal parts array', async () => {
  const bodies: unknown[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      bodies.push(JSON.parse(raw))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  try {
    const brain = new OpenAIBrain('t', 't', base, 'm')
    await brain.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'что здесь?', images: ['data:image/png;base64,QQ=='] }
      ],
      { maxTokens: 16 }
    )
    const msgs = (bodies.at(-1) as { messages: { role: string; content: unknown }[] }).messages
    assert.equal(msgs[0]!.content, 'sys', 'system stays a plain string')
    const parts = msgs[1]!.content as { type: string }[]
    assert.equal(parts[0]!.type, 'text')
    assert.equal(parts[1]!.type, 'image_url')
    // plain messages pass through untouched
    await brain.chat([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'просто текст' }
    ])
    const plain = (bodies.at(-1) as { messages: { content: unknown }[] }).messages
    assert.equal(plain[1]!.content, 'просто текст')
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((r) => server.close(() => r()))
  }
})
