// MCP manager: load config, connect servers, collect tools.
// A dead server never kills the host — it degrades to a warning.

import { readFile } from 'node:fs/promises'
import { McpClient, mcpToTool, type McpServerConfig } from './client.js'
import type { Tool } from '../protocol/types.js'

export interface McpFleet {
  clients: McpClient[]
  tools: Tool[]
  errors: string[]
}

export async function connectMcp(configPath: string): Promise<McpFleet> {
  const fleet: McpFleet = { clients: [], tools: [], errors: [] }
  let config: { servers?: Record<string, McpServerConfig> }
  try {
    config = JSON.parse(await readFile(configPath, 'utf-8')) as typeof config
  } catch (e) {
    fleet.errors.push(`config unreadable: ${(e as Error).message}`)
    return fleet
  }
  const entries = Object.entries(config.servers ?? {})
  await Promise.all(
    entries.map(async ([name, cfg]) => {
      const client = new McpClient(name, cfg)
      try {
        await client.start()
        const defs = await client.listTools()
        fleet.clients.push(client)
        for (const def of defs) fleet.tools.push(mcpToTool(name, def, client))
      } catch (e) {
        fleet.errors.push(`${name}: ${(e as Error).message}`)
        client.stop()
      }
    })
  )
  return fleet
}

export function stopFleet(fleet: McpFleet | null): void {
  fleet?.clients.forEach((c) => c.stop())
}
