// TTS organ: speaks through the host's piper/tts_service (Heretic-mode).

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Tool, ToolResult } from '../protocol/types.js'

const HERETIC_OS = join(homedir(), 'Heretic-Os')
const TTS_SCRIPT = join(HERETIC_OS, 'organa', 'tts_service.py')
const VENV_PY = join(HERETIC_OS, '.swarm-venv', 'bin', 'python')

export const ttsSpeak: Tool = {
  name: 'tts.speak',
  description: 'Text-to-speech through the host piper/tts service (Heretic-mode organ). Degrades gracefully when absent.',
  mutating: true,
  async run(args): Promise<ToolResult> {
    const text = String(args.text ?? '').trim()
    if (!text) return { ok: false, output: 'tts.speak: args.text required' }
    const { existsSync } = await import('node:fs')
    if (!existsSync(TTS_SCRIPT) || !existsSync(VENV_PY)) {
      return { ok: false, output: 'tts.speak: TTS service not found (Heretic-mode organ — degrades on strangers)' }
    }
    return new Promise((resolve) => {
      execFile(VENV_PY, [TTS_SCRIPT, '--text', text.slice(0, 500)], { timeout: 30_000 }, (err, stdout) => {
        if (err) resolve({ ok: false, output: `tts.speak failed: ${err.message.slice(0, 200)}` })
        else resolve({ ok: true, output: String(stdout).trim() || 'spoken' })
      })
    })
  }
}

export const ttsTools: Tool[] = [ttsSpeak]
