// ═══════════════════════════════════════════════════════════
// HERETIC — Browser tool (the agent's eyes)
// ═══════════════════════════════════════════════════════════
// WebContentsView (Electron 30+ API, not the deprecated BrowserView)
// attached as a bottom pane. Every open returns title + text excerpt
// + a screenshot into the sandbox — verification the user can see.
// Lives in desktop (needs Electron); engine stays pure Node.

import { BrowserWindow, WebContentsView } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Tool, ToolContext, ToolResult } from '../../../src/protocol/types'
import { assertSafeUrl } from '../../../src/tools/url-guard'

const LOAD_TIMEOUT_MS = 20_000
const PANE_FRACTION = 0.45

export function createBrowserTool(getWin: () => BrowserWindow | null): Tool {
  let view: WebContentsView | null = null

  const ensureView = (w: BrowserWindow): WebContentsView => {
    if (view) return view
    view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const layout = (): void => {
      if (!view || w.isDestroyed()) return
      const [width = 0, height = 0] = w.getContentSize()
      const paneH = Math.floor(height * PANE_FRACTION)
      view.setBounds({ x: 0, y: height - paneH, width, height: paneH })
    }
    w.on('resize', layout)
    layout()
    w.contentView.addChildView(view)
    return view
  }

  return {
    name: 'browser.open',
    description:
      'Open a URL (http/https only) in the agent browser pane. Returns page title, a text excerpt and a screenshot path in the sandbox. Use it to read pages and verify your own work.',
    mutating: true,
    async run(args, ctx: ToolContext): Promise<ToolResult> {
      const url = String(args.url ?? '')
      const guard = assertSafeUrl(url)
      if (!guard.ok) return { ok: false, output: `browser.open: ${guard.message}` }

      const w = getWin()
      if (!w || w.isDestroyed()) return { ok: false, output: 'browser.open: no window to attach the pane' }

      const v = ensureView(w)
      try {
        const loaded = v.webContents.loadURL(url.trim())
        await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('load timeout')), LOAD_TIMEOUT_MS))])
      } catch (e) {
        return { ok: false, output: `browser.open: failed to load — ${(e as Error).message}` }
      }

      let title = ''
      let excerpt = ''
      try {
        title = v.webContents.getTitle()
        excerpt = await v.webContents.executeJavaScript(
          'document.body ? document.body.innerText.slice(0, 1500) : ""',
          true
        )
      } catch {
        // headless-ish pages may refuse JS — title/url still useful
      }

      let shotNote = ''
      try {
        const dir = join(ctx.sandboxRoot, 'shots')
        await mkdir(dir, { recursive: true })
        const name = `shot-${Date.now()}.png`
        const image = await v.webContents.capturePage()
        await writeFile(join(dir, name), image.toPNG())
        shotNote = `\nscreenshot: shots/${name}`
      } catch {
        shotNote = '\nscreenshot: failed'
      }

      return {
        ok: true,
        output: `title: ${title}\nurl: ${url.trim()}\nexcerpt: ${String(excerpt).slice(0, 800)}${shotNote}`
      }
    }
  }
}
