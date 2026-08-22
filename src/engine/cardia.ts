// ═══════════════════════════════════════════════════════════
// CARDIA bridge — read-only ECG tail for the organism's heartbeat.
// The journal is append-only JSONL (forgia/swarm/cardia.py):
//   {cycle_id: N, ...} — lobe alternates by parity:
//   even -> A (qwable), odd -> B (qwythos).
// We READ only. The heart is never touched from here.
// ═══════════════════════════════════════════════════════════

import { open, stat } from 'node:fs/promises'

export interface CardiaBeat {
  cycle: number
  lobe: 'A' | 'B'
  lobeName: string
  raw: Record<string, unknown>
}

/** Tolerant single-line parser. Returns null on garbage / no cycle id. */
export function parseCardiaBeat(line: string): CardiaBeat | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let rec: Record<string, unknown>
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>
    if (!j || typeof j !== 'object') return null
    rec = j
  } catch {
    return null
  }
  const cycleRaw = rec.cycle_id ?? rec.cycle ?? rec.n
  const cycle = Number(cycleRaw)
  if (!Number.isFinite(cycle) || cycle < 0) return null

  const lobeField = String(rec.lobe ?? rec.active_lobe ?? '').toLowerCase()
  if (lobeField === 'a' || lobeField.includes('qwable')) {
    return { cycle, lobe: 'A', lobeName: 'qwable', raw: rec }
  }
  if (lobeField === 'b' || lobeField.includes('qwythos')) {
    return { cycle, lobe: 'B', lobeName: 'qwythos', raw: rec }
  }
  // parity derivation (cardia.py: even -> A/qwable)
  return {
    cycle,
    lobe: cycle % 2 === 0 ? 'A' : 'B',
    lobeName: cycle % 2 === 0 ? 'qwable' : 'qwythos',
    raw: rec
  }
}

/**
 * Tail-watch the journal with offset polling. Calls onBeat for every NEW
 * complete line (deduped by cycle), once at start with the last known beat.
 * Absent file = flatline: no beats, no errors. Returns a stop() function.
 */
export function watchCardia(
  path: string,
  onBeat: (b: CardiaBeat) => void,
  intervalMs = 3000
): () => void {
  let offset = 0
  let lastCycle = -1
  let stopped = false
  let firstSweep = true

  const sweep = async (): Promise<void> => {
    if (stopped) return
    try {
      const info = await stat(path)
      if (info.size < offset) offset = 0 // truncation/rotation — restart tail
      if (info.size === offset) return
      const handle = await open(path, 'r')
      try {
        const len = info.size - offset
        const buf = Buffer.alloc(len)
        await handle.read(buf, 0, len, offset)
        offset = info.size
        const text = buf.toString('utf-8')
        const lines = text.split('\n')
        const fresh: CardiaBeat[] = []
        for (const line of lines.filter((l) => l.trim())) {
          const beat = parseCardiaBeat(line)
          if (beat && beat.cycle !== lastCycle) {
            lastCycle = beat.cycle
            fresh.push(beat)
          }
        }
        // ECG semantics: the first sweep reports the CURRENT state (last beat),
        // not a replay of the whole history.
        for (const b of firstSweep ? fresh.slice(-1) : fresh) onBeat(b)
      } finally {
        await handle.close()
      }
    } catch {
      if (firstSweep) {
        firstSweep = false
      }
      // flatline: journal absent or unreadable — the heart owes us nothing
    } finally {
      firstSweep = false
    }
  }

  void sweep()
  const timer = setInterval(() => void sweep(), intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
