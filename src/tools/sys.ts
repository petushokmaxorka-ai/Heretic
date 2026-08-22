// sys.info — host vitals for the agent (node:os, zero deps, read-only).

import { arch, cpus, freemem, totalmem, uptime } from 'node:os'
import type { Tool, ToolResult } from '../protocol/types.js'

export const sysInfo: Tool = {
  name: 'sys.info',
  description: 'Host vitals: CPU model/cores, RAM free/total, uptime. Read-only.',
  mutating: false,
  async run(): Promise<ToolResult> {
    const list = cpus()
    const model = list[0]?.model?.trim() ?? 'unknown'
    const gb = (n: number): string => (n / 1024 / 1024 / 1024).toFixed(1)
    return {
      ok: true,
      output: [
        `cpu: ${model} x${list.length} (${arch()})`,
        `ram: ${gb(freemem())} free / ${gb(totalmem())} GB`,
        `uptime: ${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`
      ].join('\n')
    }
  }
}
