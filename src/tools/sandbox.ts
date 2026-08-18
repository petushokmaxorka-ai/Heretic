// Path safety: every agent path is resolved inside the sandbox root.
// Escape attempts throw — the agent ledger records them as REJECTED.

import { resolve, sep } from 'node:path'

export class Sandbox {
  readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  resolve(rel: string): string {
    const p = resolve(this.root, rel)
    if (p !== this.root && !p.startsWith(this.root + sep)) {
      throw new Error(`path escape rejected: ${rel}`)
    }
    return p
  }
}

export function lineDiff(oldText: string, newText: string): { added: number; removed: number; sample: string[] } {
  const oldLines = oldText ? oldText.split('\n') : []
  const newLines = newText.split('\n')
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  let added = 0
  let removed = 0
  for (const l of newLines) if (!oldSet.has(l)) added++
  for (const l of oldLines) if (!newSet.has(l)) removed++
  const sample = newLines.filter((l) => !oldSet.has(l)).slice(0, 5).map((l) => `+ ${l}`)
  return { added, removed, sample }
}
