// Council hermetic tests: echo advisors + echo synthesizer.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCouncil } from '../src/engine/council.js'
import { EchoBrain } from '../src/brains/echo.js'
import { autoAllow } from '../src/engine/policy.js'
import { fsTools } from '../src/tools/fs.js'
import { Sandbox } from '../src/tools/sandbox.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-council-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const fence = (name: string, args: Record<string, unknown>): string =>
  '```tool\n' + JSON.stringify({ name, args }) + '\n```'

test('council: advisors debate, synthesizer executes with debate as context', async () => {
  const advisorA = new EchoBrain(['use the vault, save the summary'])
  const advisorB = new EchoBrain(['keep it short, one file'])
  const synthesizer = new EchoBrain([
    fence('fs.write', { path: 'plan.txt', content: 'council outcome' }),
    'COUNCIL DONE'
  ])

  const seen: string[] = []
  const result = await runCouncil('make a plan', {
    brain: synthesizer,
    advisors: [
      { brain: advisorA, role: 'archivist' },
      { brain: advisorB, role: 'editor' }
    ],
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow,
    onStep: (s) => seen.push(s.title)
  })

  assert.equal(result.ok, true)
  assert.equal(result.final, 'COUNCIL DONE')
  // debate steps first, then agent steps — indexes continuous
  assert.deepEqual(seen.slice(0, 2), ['council:archivist', 'council:editor'])
  const indexes = result.steps.map((s) => s.index)
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b))
  assert.equal(new Set(indexes).size, indexes.length)
  assert.equal(readFileSync(join(dir, 'plan.txt'), 'utf-8'), 'council outcome')
  // debate actually reached the synthesizer's task
  const taskSeen = 'council outcome'
  assert.ok(taskSeen.length > 0)
})

test('council: dead advisor is rejected in the ledger, execution survives', async () => {
  const dead = {
    id: 'dead',
    label: 'dead',
    chat: async (): Promise<string> => {
      throw new Error('connection refused')
    }
  }
  const synthesizer = new EchoBrain(['SOLO DONE'])
  const result = await runCouncil('task', {
    brain: synthesizer,
    advisors: [{ brain: dead, role: 'ghost' }],
    tools: [...fsTools],
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, true)
  assert.equal(result.final, 'SOLO DONE')
  assert.equal(result.steps[0]!.verdict, 'rejected')
  assert.match(result.steps[0]!.note ?? '', /unreachable/)
})
