import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeUrl } from '../src/tools/url-guard.js'

test('url-guard: accepts http and https', () => {
  assert.equal(assertSafeUrl('http://127.0.0.1:7777/chat').ok, true)
  assert.equal(assertSafeUrl('https://example.com/page?x=1').ok, true)
})

test('url-guard: rejects empty and malformed', () => {
  assert.equal(assertSafeUrl('').ok, false)
  assert.equal(assertSafeUrl('not a url').ok, false)
  assert.equal(assertSafeUrl('example.com/no-scheme').ok, false)
})

test('url-guard: rejects dangerous schemes', () => {
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y', 'data:text/html,x', 'chrome://version']) {
    const r = assertSafeUrl(bad)
    assert.equal(r.ok, false, bad)
    assert.match(r.message ?? '', /not allowed|invalid/)
  }
})
