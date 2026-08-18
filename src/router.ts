// Router v1 — "@brain task" prefix routes to a named brain, default otherwise.
// The visual council comes later; escalation rules grow here.

export interface RouteDecision {
  brainId: string
  task: string
}

export function routeTask(task: string, defaultBrainId: string): RouteDecision {
  const m = task.match(/^@([a-z0-9_-]+)\s+/i)
  if (m) {
    return { brainId: m[1]!.toLowerCase(), task: task.slice(m[0].length) }
  }
  return { brainId: defaultBrainId, task }
}
