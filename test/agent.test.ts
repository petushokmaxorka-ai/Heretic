// Hermetic agent-loop tests: EchoBrain scripts the turns, everything
// runs in a tmp sandbox. No GPU, no services, deterministic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../src/engine/agent.js'
import { autoAllow, denyAll } from '../src/engine/policy.js'
import { EchoBrain } from '../src/brains/echo.js'
import { fsTools } from '../src/tools/fs.js'
import { shellTool } from '../src/tools/shell.js'
import { Sandbox } from '../src/tools/sandbox.js'

const TOOLS = [...fsTools, shellTool]

function fence(name: string, args: Record<string, unknown>): string {
  return '```tool\n' + JSON.stringify({ name, args }) + '\n```'
}

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-agent-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('agent: writes a file via tool call and finishes', async () => {
  const brain = new EchoBrain([
    fence('fs.write', { path: 'note.txt', content: 'first' }),
    'DONE'
  ])
  const result = await runAgent('save a note', {
    brain,
    tools: TOOLS,
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, true)
  assert.equal(result.final, 'DONE')
  assert.equal(readFileSync(join(dir, 'note.txt'), 'utf-8'), 'first')
  const toolSteps = result.steps.filter((s) => s.kind === 'tool')
  assert.equal(toolSteps.length, 1)
  assert.equal(toolSteps[0]!.verdict, 'verified')
})

test('agent: escape attempt is rejected, loop survives, honest ledger', async () => {
  const brain = new EchoBrain([
    fence('fs.write', { path: '../escape.txt', content: 'nope' }),
    fence('fs.write', { path: 'inside.txt', content: 'fine' }),
    'RECOVERED'
  ])
  const result = await runAgent('try to escape then behave', {
    brain,
    tools: TOOLS,
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, true)
  assert.equal(result.final, 'RECOVERED')
  assert.equal(existsSync(join(dir, '../escape.txt')), false)
  assert.equal(existsSync(join(dir, 'inside.txt')), true)
  assert.equal(result.steps[0]!.verdict, 'rejected')
  assert.equal(result.steps[1]!.verdict, 'verified')
})

test('agent: HITL denial blocks the write', async () => {
  const brain = new EchoBrain([
    fence('fs.write', { path: 'x.txt', content: 'x' }),
    'BLOCKED ANYWAY'
  ])
  const result = await runAgent('write something', {
    brain,
    tools: TOOLS,
    sandbox: new Sandbox(dir),
    policy: denyAll
  })
  assert.equal(result.ok, true)
  assert.equal(existsSync(join(dir, 'x.txt')), false)
  assert.equal(result.steps[0]!.verdict, 'rejected')
  assert.match(result.steps[0]!.note ?? '', /policy/)
})

test('agent: unknown tool rejected, loop continues', async () => {
  const brain = new EchoBrain([
    fence('fs.delete', { path: 'a.txt' }),
    'STEERED BACK'
  ])
  const result = await runAgent('try a bogus tool', {
    brain,
    tools: TOOLS,
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.ok, true)
  assert.equal(result.final, 'STEERED BACK')
  assert.equal(result.steps[0]!.verdict, 'rejected')
})

test('agent: shell allowlist enforced inside the loop', async () => {
  const brain = new EchoBrain([
    fence('shell', { command: 'echo hello' }),
    fence('shell', { command: 'curl http://127.0.0.1:1/x' }),
    'SHELL DONE'
  ])
  const result = await runAgent('run commands', {
    brain,
    tools: TOOLS,
    sandbox: new Sandbox(dir),
    policy: autoAllow
  })
  assert.equal(result.final, 'SHELL DONE')
  assert.equal(result.steps[0]!.verdict, 'verified')
  assert.equal(result.steps[1]!.verdict, 'rejected')
})
