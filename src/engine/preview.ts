// Diff preview for approval cards — computed BEFORE the mutation,
// so manual/edits modes show exactly what will change.

import { readFile } from 'node:fs/promises'
import type { ApprovalDiff } from '../protocol/types.js'
import { Sandbox } from '../tools/sandbox.js'

const PREVIEW_CAP = 2000

export async function previewFor(
  toolName: string,
  args: Record<string, unknown>,
  sandboxRoot: string
): Promise<ApprovalDiff | undefined> {
  if (toolName !== 'fs.write' && toolName !== 'fs.edit') return undefined
  const path = String(args.path ?? '')
  if (!path) return undefined
  try {
    const sandbox = new Sandbox(sandboxRoot)
    const abs = sandbox.resolve(path)
    const before = await readFile(abs, 'utf-8').catch(() => '')
    if (toolName === 'fs.write') {
      const after = String(args.content ?? '')
      return { path, before: before.slice(0, PREVIEW_CAP), after: after.slice(0, PREVIEW_CAP) }
    }
    const oldText = String(args.old ?? '')
    const newText = String(args.new ?? '')
    const i = before.indexOf(oldText)
    if (i < 0) {
      return { path, before: before.slice(0, PREVIEW_CAP), after: '(old text not found — nothing will change)' }
    }
    const after = before.slice(0, i) + newText + before.slice(i + oldText.length)
    return { path, before: before.slice(0, PREVIEW_CAP), after: after.slice(0, PREVIEW_CAP) }
  } catch {
    return undefined
  }
}
