// Observe router hermetic tests: fast-layer verdicts on RU/EN fixtures,
// smart-layer fallback on brain failure — zero network.

import test from 'node:test'
import assert from 'node:assert/strict'
import { observe, observeSmart } from '../src/engine/observe.js'
import { EchoBrain } from '../src/brains/echo.js'

test('observe: plain question stays chat', () => {
  const v = observe('что такое рекурсия?')
  assert.equal(v.mode, 'chat')
  assert.equal(v.web, false)
  assert.ok(v.reasons.includes('question-like'))
})

test('observe: imperative with file goes agent', () => {
  const v = observe('создай файл notes.md в песочнице')
  assert.equal(v.mode, 'agent')
  assert.ok(v.reasons.includes('imperative verb'))
  assert.ok(v.reasons.includes('task-like'))
})

test('observe: path token alone goes agent', () => {
  const v = observe('fix ./config.toml please')
  assert.equal(v.mode, 'agent')
})

test('observe: fresh facts trigger web', () => {
  const v = observe('какая сейчас цена биткоина')
  assert.equal(v.web, true)
  assert.ok(v.reasons.includes('fresh facts'))
})

test('observe: explicit web ask triggers web', () => {
  const v = observe('найди в интернете релиз-ноты ядра')
  assert.equal(v.web, true)
})

test('observe: link presence triggers web', () => {
  const v = observe('что там по этой ссылке https://example.com/spec')
  assert.equal(v.web, true)
})

test('observe: reasoning verbs raise thinking', () => {
  const v = observe('объясни подробно, почему монады полезны')
  assert.ok(v.thinking === 'high' || v.thinking === 'max')
})

test('observe: deep + long message reaches max', () => {
  const long = 'сравни и проанализируй подходы. ' + 'очень важный контекст. '.repeat(20)
  const v = observe(long)
  assert.equal(v.thinking, 'max')
})

test('observe: simple chat stays mid', () => {
  const v = observe('привет, как дела')
  assert.equal(v.mode, 'chat')
  assert.equal(v.thinking, 'mid')
})

test('observeSmart: valid JSON from brain wins', async () => {
  const brain = new EchoBrain(['{"mode":"agent","web":false,"thinking":"low"}'])
  const v = observeSmart ? await observeSmart('что угодно', brain) : null
  assert.ok(v)
  assert.equal(v!.mode, 'agent')
  assert.equal(v!.thinking, 'low')
})

test('observeSmart: garbage from brain falls back to fast layer', async () => {
  const brain = new EchoBrain(['sorry, I cannot classify that'])
  const v = await observeSmart('создай файл x.md', brain)
  assert.equal(v.mode, 'agent')
  assert.ok(v.reasons.includes('smart-parse-failed'))
})
