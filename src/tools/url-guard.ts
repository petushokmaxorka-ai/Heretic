// URL guard — the browser tool's first verification layer.
// Pure function: hermetically testable, no Electron import.

export interface UrlGuardResult {
  ok: boolean
  message?: string
}

export function assertSafeUrl(raw: string): UrlGuardResult {
  if (!raw || !raw.trim()) {
    return { ok: false, message: 'url required' }
  }
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { ok: false, message: `invalid url: ${raw.slice(0, 120)}` }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, message: `scheme "${u.protocol}" not allowed (http/https only)` }
  }
  return { ok: true }
}
