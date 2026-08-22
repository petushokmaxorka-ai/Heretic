// PACK 2 hermetic tests: repair loop, few-shot prompt contract,
// JSON mode, per-brain defaults — against a stub OpenAI server.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runAgent } from '../src/engine/agent.js'
import { EchoBrain } from '../src/brains/echo.js'
import { OpenAIBrain } from '../src/brains/openai.js'
import { autoAllow } from '../src/engine/policy.js'
import { fsTools } from '../src/tools/fs.js'
import { Sandbox } from '../src/tools/sandbox.js'

const fence = (name: string, args: Record<string, unknown>): string =>
  '```tool\n' + JSON.stringify({ name, args }) + '\n```'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-p2-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('repair loop: malformed JSON gets one repair, then success', async () => {
  const brain = new EchoBrain([
    '```tool\n{"name": "fs.write", "path": "n.txt", content: oops}\n```', // broken JSON
    fence('fs.write', { path: 'n.txt', content: 'fixed' }),
    'RECOVERED'
  ])
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, true)
  assert.equal(result.final, 'RECOVERED')
  assert.equal(readFileSync(join(dir, 'n.txt'), 'utf-8'), 'fixed')
  assert.match(result.steps[0]!.note ?? '', /repair requested/)
  assert.equal(result.steps[1]!.verdict, 'verified')
})

test('repair loop: two violations in a row — honest give-up', async () => {
  const brain = new EchoBrain([
    '```tool\n{broken\n```',
    '```tool\n{still broken\n```'
  ])
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, false)
  assert.equal(existsSync(join(dir, 'nothing.txt')), false)
  assert.match(result.steps.at(-1)!.detail, /repeated protocol violations/)
})

test('unknown tool error lists the available tools (repair hint)', async () => {
  const brain = new EchoBrain([fence('fs.teleport', { path: 'x' }), 'STEERED'])
  const result = await runAgent('task', {
    brain,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.final, 'STEERED')
  assert.match(result.steps[0]!.note ?? '', /fs\.read/)
})

test('contract: few-shot examples reach the brain via the agent', async () => {
  const seen: { role: string; content: string }[][] = []
  const recorder = {
    id: 'rec',
    label: 'rec',
    chat: async (messages: { role: string; content: string }[]): Promise<string> => {
      seen.push(messages)
      return 'done'
    }
  }
  await runAgent('task', {
    brain: recorder,
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.ok(seen.length >= 1, 'brain must be called')
  assert.match(
    seen[0]![0]!.content,
    /Example — recovering from an error/,
    'few-shot examples must be in the agent system prompt'
  )
})

test('contract: json mode and per-brain defaults reach the backend', async () => {
  const seen: { body: Record<string, unknown> }[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      seen.push({ body: JSON.parse(raw) as Record<string, unknown> })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  try {
    const brain = new OpenAIBrain('t', 't', base, 'm')
    await brain.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'u' }])
    await brain.chat([{ role: 'user', content: 'classify' }], { responseFormat: 'json' })
    const rf = seen.at(-1)!.body.response_format as { type: string } | undefined
    assert.equal(rf?.type, 'json_object')

    const tuned = new OpenAIBrain('t2', 't2', base, 'm', undefined, {
      temperature: 0.7,
      maxTokens: 77,
      promptSuffix: 'ANSWER IN RHYME.'
    })
    await tuned.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'u' }])
    const b = seen.at(-1)!.body
    assert.equal(b.temperature, 0.7)
    assert.equal(b.max_tokens, 77)
    const sys = (b.messages as { role: string; content: string }[])[0]!
    assert.match(sys.content, /ANSWER IN RHYME\.$/)
  } finally {
    server.closeAllConnections?.()
    await new Promise<void>((r) => server.close(() => r()))
  }
})
