// ═══════════════════════════════════════════════════════════
// MCP client — Model Context Protocol over stdio (JSON-RPC 2.0).
// Zero deps: spawn the server, newline-delimited messages,
// initialize handshake, tools/list -> Tool[], tools/call.
// ═══════════════════════════════════════════════════════════

import { spawn, type ChildProcess } from 'node:child_process'
import type { Tool, ToolResult } from '../protocol/types.js'

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

interface Pending {
  resolve: (m: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class McpClient {
  private proc: ChildProcess | null = null
  private nextId = 0
  private readonly pending = new Map<number, Pending>()

  constructor(
    readonly name: string,
    private readonly cfg: McpServerConfig
  ) {}

  async start(timeoutMs = 10_000): Promise<void> {
    this.proc = spawn(this.cfg.command, this.cfg.args ?? [], {
      env: { ...process.env, ...this.cfg.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let buffer = ''
    this.proc.stdout!.setEncoding('utf-8')
    this.proc.stdout!.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { id?: number }
          if (typeof msg.id === 'number') this.pending.get(msg.id)?.resolve(msg)
        } catch {
          // non-JSON noise from the server — ignore
        }
      }
    })
    this.proc.stderr!.setEncoding('utf-8')
    this.proc.stderr!.on('data', () => {
      // server logs go nowhere by design
    })
    this.proc.on('error', (e) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`mcp server "${this.name}" failed: ${e.message}`))
        clearTimeout(p.timer)
      }
      this.pending.clear()
    })
    this.proc.on('exit', () => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`mcp server "${this.name}" exited`))
        clearTimeout(p.timer)
      }
      this.pending.clear()
    })
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'heretic', version: '1.4.0' }
    }, timeoutMs)
    this.notify('notifications/initialized')
  }

  private rpc(method: string, params: Record<string, unknown>, timeoutMs = 20_000): Promise<{ result?: unknown; error?: { message?: string } }> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`mcp "${this.name}" ${method} timeout (${timeoutMs}ms)`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer)
          this.pending.delete(id)
          resolve(m as { result?: unknown; error?: { message?: string } })
        },
        reject: (e) => {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(e)
        },
        timer
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string): void {
    this.write({ jsonrpc: '2.0', method })
  }

  private write(msg: unknown): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  async listTools(): Promise<McpToolDef[]> {
    const r = await this.rpc('tools/list', {})
    if (r.error) throw new Error(r.error.message ?? 'tools/list failed')
    const result = r.result as { tools?: McpToolDef[] } | undefined
    return result?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const r = await this.rpc('tools/call', { name, arguments: args })
      if (r.error) return { ok: false, output: `mcp error: ${r.error.message ?? 'unknown'}` }
      const result = r.result as { content?: { type: string; text?: string }[]; isError?: boolean } | undefined
      const text = (result?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
      return { ok: !result?.isError, output: text || '(no text output)' }
    } catch (e) {
      return { ok: false, output: `mcp.${this.name}.${name} failed: ${(e as Error).message}` }
    }
  }

  stop(): void {
    try {
      this.proc?.kill('SIGTERM')
    } catch {
      // already gone
    }
    this.proc = null
  }
}

/** Wrap an MCP tool def into our Tool interface. */
export function mcpToTool(server: string, def: McpToolDef, client: McpClient): Tool {
  return {
    name: `mcp.${server}.${def.name}`,
    description: `[mcp:${server}] ${def.description ?? def.name}`,
    mutating: !def.annotations?.readOnlyHint, // unknown externals pass the approval gate
    run: (args) => client.callTool(def.name, args)
  }
}
