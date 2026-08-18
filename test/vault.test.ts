import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vaultRemember, vaultRecall } from '../src/tools/vault.js'

let dir: string
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'anath-vault-'))
})
test.afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('vault: remember then recall finds the fact', async () => {
  const r1 = await vaultRemember.run({ text: 'The user prefers teal for verification states' }, { sandboxRoot: dir })
  const r2 = await vaultRemember.run({ text: 'Server port for llama-swap is 11436' }, { sandboxRoot: dir })
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, true)

  const recall = await vaultRecall.run({ query: 'llama-swap port number' }, { sandboxRoot: dir })
  assert.equal(recall.ok, true)
  assert.match(recall.output, /11436/)
  assert.ok(!recall.output.includes('teal'), 'irrelevant memory must not surface first')
})

test('vault: empty and irrelevant queries handled honestly', async () => {
  const empty = await vaultRecall.run({ query: 'anything' }, { sandboxRoot: dir })
  assert.equal(empty.ok, true)
  assert.match(empty.output, /empty/)

  await vaultRemember.run({ text: 'lorem ipsum dolor' }, { sandboxRoot: dir })
  const miss = await vaultRecall.run({ query: 'quantum entanglement' }, { sandboxRoot: dir })
  assert.equal(miss.ok, true)
  assert.match(miss.output, /nothing relevant/)
})

test('vault: rejects empty args', async () => {
  const r = await vaultRemember.run({}, { sandboxRoot: dir })
  assert.equal(r.ok, false)
})
