// Approval policies — the HITL gate. Trust modes map onto these:
// manual → interactive, edits/auto → scoped variants, dry → denyAll.

import type { ApprovalPolicy } from '../protocol/types.js'

export const autoAllow: ApprovalPolicy = {
  allow: async () => true
}

export const denyAll: ApprovalPolicy = {
  allow: async () => false
}

export function interactiveAllow(ask: (action: string, detail: string) => Promise<boolean>): ApprovalPolicy {
  return { allow: ask }
}
