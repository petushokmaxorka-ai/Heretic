// ═══════════════════════════════════════════════════════════
// HERETIC — Desktop main process (the shell; zero brain in renderer)
// ═══════════════════════════════════════════════════════════
// Engine (Anathemetron) runs here; renderer only sees IPC events.
// Close-to-tray: the window can die, the organism keeps ticking.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from 'electron'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from '../../../src/engine/agent'
import { EchoBrain } from '../../../src/brains/echo'
import { OpenAIBrain } from '../../../src/brains/openai'
import { autoAllow, denyAll } from '../../../src/engine/policy'
import { discoverLocal } from '../../../src/discovery'
import { fsTools } from '../../../src/tools/fs'
import { shellTool } from '../../../src/tools/shell'
import { Sandbox } from '../../../src/tools/sandbox'
import type { ApprovalPolicy, Brain } from '../../../src/protocol/types'
import { createBrowserTool } from './browser-tool'
import { initUpdater } from './updater'
import { IPC, type BrainConfig, type TrustMode } from '../shared/ipc'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let sessionRunning = false
const pendingApprovals = new Map<number, (ok: boolean) => void>()

// 8x8 crimson dot — the tray pulse until a real icon ships.
const DOT_ON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFI0chAG+bBj3p6QdGAAAAAElFTkSuQmCC'
)

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    backgroundColor: '#050505',
    title: 'HERETIC',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })
  win.on('close', (e) => {
    // Close-to-tray: the shell survives, the organism keeps ticking.
    e.preventDefault()
    win?.hide()
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  tray = new Tray(DOT_ON)
  tray.setToolTip('◆ HERETIC — idle')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '◆ Open', click: () => win?.show() },
      { type: 'separator' },
      { label: '✗ Quit', click: () => { app.exit(0) } }
    ])
  )
}

function buildBrain(cfg: BrainConfig): Brain {
  if (cfg.kind === 'echo') return new EchoBrain(['OK — echo brain (offline demo)'])
  return new OpenAIBrain(
    'local',
    cfg.url ?? 'http://127.0.0.1:11436/',
    cfg.url ?? '',
    cfg.model ?? 'default',
    cfg.key
  )
}

function policyFor(mode: TrustMode): ApprovalPolicy {
  if (mode === 'auto') return autoAllow
  if (mode === 'dry') return denyAll
  return {
    allow: (action, detail) =>
      new Promise<boolean>((resolve) => {
        const id = Date.now() + Math.random()
        pendingApprovals.set(id, resolve)
        send(IPC.APPROVAL_REQUEST, { id, action, detail })
      })
  }
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  initUpdater((line) => console.log(line))

  ipcMain.handle(IPC.BRAINS_SCAN, async () => discoverLocal())

  ipcMain.handle(IPC.APPROVAL_DECIDE, (_e, { id, ok }: { id: number; ok: boolean }) => {
    pendingApprovals.get(id)?.(ok)
    pendingApprovals.delete(id)
  })

  ipcMain.handle(IPC.SESSION_RUN, async (_e, { task, brain, trust, root }: {
    task: string
    brain: BrainConfig
    trust: TrustMode
    root?: string
  }) => {
    if (sessionRunning) return { ok: false, error: 'session already running' }
    sessionRunning = true
    tray?.setToolTip('◆ HERETIC — agent running')
    const sandboxRoot = root ?? join(tmpdir(), `heretic-sandbox-${process.getuid?.() ?? 0}`)
    mkdirSync(sandboxRoot, { recursive: true })
    try {
      const result = await runAgent(task, {
        brain: buildBrain(brain),
        tools: [...fsTools, shellTool, createBrowserTool(() => win)],
        sandbox: new Sandbox(sandboxRoot),
        policy: policyFor(trust),
        maxSteps: 12,
        onStep: (step) => send(IPC.SESSION_STEP, step)
      })
      send(IPC.SESSION_FINAL, result)
      if (!win || win.isDestroyed() || !win.isVisible()) {
        new Notification({
          title: result.ok ? '◆ HERETIC — session complete' : '✗ HERETIC — session failed',
          body: result.ok ? result.final.slice(0, 200) : 'open the ledger for details'
        }).show()
      }
      return { ok: true }
    } catch (e) {
      send(IPC.SESSION_FINAL, { ok: false, final: String((e as Error).message), steps: [] })
      return { ok: false, error: (e as Error).message }
    } finally {
      sessionRunning = false
      tray?.setToolTip('◆ HERETIC — idle')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // tray keeps the app alive on all platforms
})
