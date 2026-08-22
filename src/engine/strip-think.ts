// Strip reasoning-model <think> blocks from replies — the ledger shows
// thinking via onDelta; stored answers stay clean.

export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
  // unclosed trailing think (truncated stream): drop from the opening tag
  const open = out.lastIndexOf('<think>')
  if (open >= 0 && out.indexOf('</think>', open) < 0) {
    out = out.slice(0, open)
  }
  return out.trim()
}
