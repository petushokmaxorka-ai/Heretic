// Host-mode reader: work/game/ordo — the рубильник state.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Tool, ToolResult } from '../protocol/types.js'

const MODE_FILE = join(homedir(), '.local/state/heretic-os/mode')

export const modeGet: Tool = {
  name: 'mode.get',
  description: 'Read the host mode flag: work|game|ordo (heretic-mode kill switch state). Read-only.',
  mutating: false,
  async run(): Promise<ToolResult> {
    try {
      const mode = (await readFile(MODE_FILE, 'utf-8')).trim()
      if (!['work', 'game', 'ordo'].includes(mode)) {
        return { ok: true, output: `unknown mode: "${mode}"` }
      }
      const hints: Record<string, string> = {
        work: 'full stack is up — all organs available',
        game: 'heavy services are down — VRAM free for the game',
        ordo: 'body sleeps, brain lives — llama-swap in codex profile only'
      }
      return { ok: true, output: `mode: ${mode}\n${hints[mode] ?? ''}` }
    } catch {
      return { ok: false, output: 'mode.get: no mode flag (not a HereticArch host or never set)' }
    }
  }
}

export const organExtraTools: Tool[] = [modeGet]
