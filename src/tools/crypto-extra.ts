// Crypto extras: AES-256-GCM encrypt/decrypt, random bytes, file hash.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Tool, ToolResult } from '../protocol/types.js'
import { Sandbox } from './sandbox.js'

export const cryptoEncrypt: Tool = {
  name: 'crypto.encrypt',
  description: 'AES-256-GCM encrypt text: {text, key (passphrase), output: base64|hex (default base64)}. Returns iv:ciphertext:tag.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '')
    const key = String(args.key ?? '')
    if (!text || !key) return { ok: false, output: 'crypto.encrypt: args.text and args.key required' }
    try {
      const keyHash = createHash('sha256').update(key).digest()
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', keyHash, iv)
      const enc = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()])
      const tag = cipher.getAuthTag()
      const format = String(args.output ?? 'base64') === 'hex' ? 'hex' : 'base64'
      return { ok: true, output: `${iv.toString(format)}:${enc.toString(format)}:${tag.toString(format)}` }
    } catch (e) {
      return { ok: false, output: `crypto.encrypt failed: ${(e as Error).message}` }
    }
  }
}

export const cryptoDecrypt: Tool = {
  name: 'crypto.decrypt',
  description: 'AES-256-GCM decrypt: {data (iv:ciphertext:tag), key, input: base64|hex}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const data = String(args.data ?? '')
    const key = String(args.key ?? '')
    if (!data || !key) return { ok: false, output: 'crypto.decrypt: args.data and args.key required' }
    try {
      const format = String(args.input ?? 'base64') === 'hex' ? 'hex' : 'base64'
      const [ivB64, encB64, tagB64] = data.split(':')
      if (!ivB64 || !encB64 || !tagB64) return { ok: false, output: 'crypto.decrypt: data must be iv:ciphertext:tag' }
      const keyHash = createHash('sha256').update(key).digest()
      const decipher = createDecipheriv('aes-256-gcm', keyHash, Buffer.from(ivB64, format))
      decipher.setAuthTag(Buffer.from(tagB64, format))
      const dec = Buffer.concat([decipher.update(Buffer.from(encB64, format)), decipher.final()])
      return { ok: true, output: dec.toString('utf-8') }
    } catch (e) {
      return { ok: false, output: `crypto.decrypt failed (wrong key or corrupted data): ${(e as Error).message}` }
    }
  }
}

export const cryptoRandom: Tool = {
  name: 'crypto.random',
  description: 'Cryptographically secure random: {type: int|bytes|hex (default int), min, max, length}.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const type = String(args.type ?? 'int')
    if (type === 'bytes' || type === 'hex') {
      const len = Math.min(1024, Number(args.length ?? 32) || 32)
      const buf = randomBytes(len)
      return { ok: true, output: type === 'hex' ? buf.toString('hex') : buf.toString('base64') }
    }
    const min = Number(args.min ?? 0) || 0
    const max = Number(args.max ?? 100) || 100
    if (max <= min) return { ok: false, output: 'crypto.random: max must be greater than min' }
    return { ok: true, output: String(randomInt(min, max)) }
  }
}

export const hashFile: Tool = {
  name: 'hash.file',
  description: 'Hash a file in the sandbox: {path, algo: md5|sha1|sha256|sha512 (default sha256)}.',
  mutating: false,
  async run(args, ctx): Promise<ToolResult> {
    const path = String(args.path ?? '')
    const algo = String(args.algo ?? 'sha256')
    if (!path) return { ok: false, output: 'hash.file: args.path required' }
    if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo)) {
      return { ok: false, output: `hash.file: algo must be md5|sha1|sha256|sha512` }
    }
    try {
      const buf = await readFile(new Sandbox(ctx.sandboxRoot).resolve(path))
      return { ok: true, output: createHash(algo).update(buf).digest('hex') }
    } catch (e) {
      return { ok: false, output: `hash.file failed: ${(e as Error).message}` }
    }
  }
}

export const cryptoExtraTools: Tool[] = [cryptoEncrypt, cryptoDecrypt, cryptoRandom, hashFile]
