// Network tools: full HTTP client, DNS, port scanner.

import { createConnection } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { Tool, ToolResult } from '../protocol/types.js'
import { assertSafeUrl } from './url-guard.js'

const MAX_BODY = 65_536
const TIMEOUT = 15_000

export const httpRequest: Tool = {
  name: 'http.request',
  description:
    'Full HTTP client: {url, method: GET|POST|PUT|PATCH|DELETE (default GET), body?, headers?, json? (parse response as JSON)}. http/https only.',
  mutating: true,
  async run(args): Promise<ToolResult> {
    const url = String(args.url ?? '')
    const guard = assertSafeUrl(url)
    if (!guard.ok) return { ok: false, output: `http.request: ${guard.message}` }
    const method = String(args.method ?? 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
      return { ok: false, output: `http.request: unsupported method "${method}"` }
    }
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Heretic/1.6',
        ...(args.headers as Record<string, string> | undefined)
      }
      let body: string | undefined
      if (args.body && typeof args.body === 'object') {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(args.body)
      } else if (args.body) {
        body = String(args.body)
      }
      const res = await fetch(url.trim(), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT),
        redirect: 'follow'
      })
      const text = await res.text()
      const truncated = text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '\n[truncated]' : text
      if (args.json === true) {
        try {
          return { ok: res.ok, output: JSON.stringify(JSON.parse(text), null, 2).slice(0, MAX_BODY) }
        } catch {
          return { ok: false, output: `http.request: response is not valid JSON\n${truncated.slice(0, 200)}` }
        }
      }
      return { ok: res.ok, output: `HTTP ${res.status} ${res.statusText}\n${truncated}` }
    } catch (e) {
      return { ok: false, output: `http.request failed: ${(e as Error).message}` }
    }
  }
}

export const dnsLookup: Tool = {
  name: 'dns.lookup',
  description: 'Resolve a hostname to IP addresses: {host}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const host = String(args.host ?? '').trim()
    if (!host) return { ok: false, output: 'dns.lookup: args.host required' }
    try {
      const records = await lookup(host, { all: true })
      return { ok: true, output: records.map((r) => `${r.address} (${r.family === 4 ? 'IPv4' : 'IPv6'})`).join('\n') }
    } catch (e) {
      return { ok: false, output: `dns.lookup failed: ${(e as Error).message}` }
    }
  }
}

export const portCheck: Tool = {
  name: 'port.check',
  description: 'Check if TCP ports are open on a host: {host (default 127.0.0.1), ports: [11436, 8000, ...]}. Read-only.',
  mutating: false,
  async run(args): Promise<ToolResult> {
    const host = String(args.host ?? '127.0.0.1')
    const ports = (Array.isArray(args.ports) ? (args.ports as unknown[]) : [11434, 11436, 8000, 7777])
      .map((p) => Number(p))
      .filter((p) => Number.isFinite(p) && p > 0 && p < 65536)
      .slice(0, 20)
    if (!ports.length) return { ok: false, output: 'port.check: args.ports array required' }
    const results = await Promise.all(
      ports.map(
        (port) =>
          new Promise<{ port: number; open: boolean }>((resolve) => {
            const socket = createConnection({ host, port, timeout: 2000 })
            socket.on('connect', () => {
              socket.destroy()
              resolve({ port, open: true })
            })
            socket.on('error', () => resolve({ port, open: false }))
            socket.on('timeout', () => {
              socket.destroy()
              resolve({ port, open: false })
            })
          })
      )
    )
    return {
      ok: true,
      output: results.map((r) => `${r.open ? '✓ open' : '✗ closed'} :${r.port}`).join('\n')
    }
  }
}

export const netTools: Tool[] = [httpRequest, dnsLookup, portCheck]
