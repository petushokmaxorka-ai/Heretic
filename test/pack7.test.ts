// PACK 7 hermetic tests: cardia beat parsing + tail watcher (temp files).

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCardiaBeat, watchCardia } from '../src/engine/cardia.js'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('parse: explicit lobe fields win', () => {
  assert.deepEqual(parseCardiaBeat('{"cycle_id": 8, "lobe": "qwable"}')?.lobe, 'A')
  assert.deepEqual(parseCardiaBeat('{"cycle_id": 9, "lobe": "qwythos"}')?.lobe, 'B')
  assert.deepEqual(parseCardiaBeat('{"cycle_id": 3, "active_lobe": "B"}')?.lobe, 'B')
})

test('parse: parity derivation when lobe absent (even=A/qwable)', () => {
  const b = parseCardiaBeat('{"cycle_id": 42, "thought": "..."}')
  assert.equal(b?.lobe, 'A')
  assert.equal(b?.lobeName, 'qwable')
  const odd = parseCardiaBeat('{"cycle_id": 7}')
  assert.equal(odd?.lobe, 'B')
  assert.equal(odd?.lobeName, 'qwythos')
})

test('parse: garbage and cycle-less lines are null', () => {
  assert.equal(parseCardiaBeat(''), null)
  assert.equal(parseCardiaBeat('not json'), null)
  assert.equal(parseCardiaBeat('{"thought": "no cycle"}'), null)
  assert.equal(parseCardiaBeat('{"cycle_id": "NaN"}'), null)
})

test('watcher: tail, dedupe by cycle, initial last beat, flatline safety', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anath-cardia-'))
  const file = join(dir, 'journal.jsonl')
  writeFileSync(file, '{"cycle_id": 1}\n{"cycle_id": 2}\n')
  const beats: number[] = []
  const stop = watchCardia(file, (b) => beats.push(b.cycle), 40)
  try {
  await sleep(100) // initial sweep delivers the LAST beat only (cycle 2)
  assert.deepEqual(beats, [2])

  appendFileSync(file, '{"cycle_id": 3}\n') // odd -> B
  await sleep(120)
  assert.deepEqual(beats, [2, 3])

  appendFileSync(file, '{"cycle_id": 3, "dup": true}\n') // same cycle — deduped
  await sleep(120)
  assert.deepEqual(beats, [2, 3])

  } finally {
    stop()
  }
  appendFileSync(file, '{"cycle_id": 4}\n')
  await sleep(120)
  assert.deepEqual(beats, [2, 3], 'stopped watcher must stay silent')

  // flatline: watcher on an absent file never throws
  const stop2 = watchCardia(join(dir, 'ghost.jsonl'), () => {}, 30)
  try {
    await sleep(80)
  } finally {
    stop2()
  }
  rmSync(dir, { recursive: true, force: true })
})
