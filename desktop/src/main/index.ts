// ═══════════════════════════════════════════════════════════
// HERETIC — Desktop main process (the shell; zero brain in renderer)
// ═══════════════════════════════════════════════════════════
// Engine (Anathemetron) runs here; renderer only sees IPC events.
// Close-to-tray: the window can die, the organism keeps ticking.

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, safeStorage, globalShortcut, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { existsSync as fsExists } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { runAgent } from '../../../src/engine/agent'
import { runCouncil } from '../../../src/engine/council'
import { skullGuardAll } from '../../../src/engine/skull'
import { EchoBrain } from '../../../src/brains/echo'
import { OpenAIBrain } from '../../../src/brains/openai'
import { autoAllow, denyAll } from '../../../src/engine/policy'
import { discoverLocal } from '../../../src/discovery'
import { fsTools } from '../../../src/tools/fs'
import { shellTool } from '../../../src/tools/shell'
import { Sandbox } from '../../../src/tools/sandbox'
import { vaultTools } from '../../../src/tools/vault'
import type { ApprovalPolicy, Brain } from '../../../src/protocol/types'
import { createBrowserTool } from './browser-tool'
import { initUpdater } from './updater'
import { watchCardia, type CardiaBeat } from '../../../src/engine/cardia'
import { IPC, type BrainConfig, type TrustMode, type ChatRequestPayload, type AutoRequestPayload } from '../shared/ipc'
import { runChat } from '../../../src/engine/chat'
import { observe } from '../../../src/engine/observe'
import { webSearchTool } from '../../../src/tools/search'
import { codeSearch } from '../../../src/tools/code'
import { fetchTool } from '../../../src/tools/fetch'
import { planTools } from '../../../src/tools/plan'
import { llamaStatusTool, getResidents, pickResident } from '../../../src/tools/llama'
import { memoriaQuery, servicesHealth } from '../../../src/tools/organs'
import { discoverSearxng } from '../../../src/discovery'

// voice: the host whisper function (read-only usage — we spawn, never modify)
const HERETIC_OS = join(process.env.HOME ?? '/home/heretic', 'Heretic-Os')
const WHISPER_SCRIPT = join(HERETIC_OS, 'organa', 'speech_to_text_service.py')
const VENV_PY = join(HERETIC_OS, '.swarm-venv', 'bin', 'python')
const CARDIA_JOURNAL = join(HERETIC_OS, '.heretic', 'cardia_journal.jsonl')
const VAULT_ROOT = join(app.getPath('userData'), 'vault')

let win: BrowserWindow | null = null
let searxngBase: string | null | undefined
let sessionAbort: AbortController | null = null
let heartLabel = ''
let chatAbort: AbortController | null = null

function buildTools(): import('../../../src/protocol/types').Tool[] {
  return skullGuardAll([
    ...fsTools,
    shellTool,
    ...vaultTools,
    webSearchTool,
    codeSearch,
    fetchTool,
    ...planTools,
    llamaStatusTool,
    memoriaQuery,
    servicesHealth,
    createBrowserTool(() => win)
  ])
}

async function getSearxng(): Promise<string | null> {
  if (searxngBase === undefined) searxngBase = await discoverSearxng()
  return searxngBase
}
let tray: Tray | null = null
let sessionRunning = false
const pendingApprovals = new Map<number, (ok: boolean) => void>()

// 8x8 crimson dot — the tray pulse until a real icon ships.
function trayIcon(): Electron.NativeImage {
  const p = join(process.resourcesPath ?? '', 'icons', '32.png')
  const img = existsSync(p) ? nativeImage.createFromPath(p) : null
  return img && !img.isEmpty() ? img.resize({ width: 16, height: 16 }) : nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFI0chAG+bBj3p6QdGAAAAAElFTkSuQmCC')
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    backgroundColor: '#f6f7f9',
    title: 'Heretic',
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

function summon(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isVisible() && win.isFocused()) win.hide()
  else {
    win.show()
    win.focus()
  }
}

function createTray(): void {
  tray = new Tray(trayIcon())
  tray.setToolTip('◆ HERETIC — idle')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '◆ Summon (Alt+Space)', click: summon },
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
  if (mode === 'edits') {
    return {
      allow: async (action, detail, diff) => {
        if (action !== 'fs.write' && action !== 'fs.edit') return true
        return askUser(action, detail, diff)
      }
    }
  }
  return { allow: (action, detail, diff) => askUser(action, detail, diff) }
}

function askUser(action: string, detail: string, diff?: import('../../../src/protocol/types').ApprovalDiff): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = Date.now() + Math.random()
    pendingApprovals.set(id, resolve)
    send(IPC.APPROVAL_REQUEST, { id, action, detail, diff })
  })
}

ipcMain.handle(IPC.VOICE_STATUS, () => ({
    available: fsExists(WHISPER_SCRIPT) && fsExists(VENV_PY),
    reason: fsExists(WHISPER_SCRIPT) ? (fsExists(VENV_PY) ? '' : 'venv python not found') : 'whisper script not found'
  }))

  ipcMain.handle(IPC.VOICE_TRANSCRIBE, async (_e, { dataB64, mime }: { dataB64: string; mime: string }) => {
    const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'wav'
    const file = join(osTmpdir(), `heretic-voice-${Date.now()}.${ext}`)
    const code =
      'import sys; sys.path.insert(0, ' + JSON.stringify(join(HERETIC_OS, 'organa')) + '); ' +
      'from speech_to_text_service import transcribe_audio; print(transcribe_audio(' + JSON.stringify(file) + '))'
    try {
      await writeFile(file, Buffer.from(dataB64, 'base64'))
      const text = await new Promise<string>((resolve, reject) => {
        const p = spawn(VENV_PY, ['-c', code], { cwd: join(HERETIC_OS, 'organa') })
        let out = ''
        let err = ''
        p.stdout.on('data', (c) => (out += c))
        p.stderr.on('data', (c) => (err += c))
        p.on('error', reject)
        p.on('close', (code2) => (code2 === 0 ? resolve(out.trim()) : reject(new Error(err.slice(0, 300) || `exit ${code2}`))))
      })
      return { ok: Boolean(text), text }
    } catch (e) {
      return { ok: false, text: '', error: (e as Error).message }
    } finally {
      await import('node:fs/promises').then((fs) => fs.unlink(file).catch(() => {}))
    }
  })

app.whenReady().then(() => {
  mkdirSync(VAULT_ROOT, { recursive: true })
  createWindow()
  // CI e2e smoke: window up + 4s of life = exit 0
  if (process.argv.includes('--smoke')) {
    setTimeout(() => {
      console.log('[smoke] window ready, exiting 0')
      app.exit(0)
    }, 4000)
  }
  createTray()
  // Body bridge (read-only): the organism's ECG in the tray.
  watchCardia(CARDIA_JOURNAL, (b: CardiaBeat) => {
    heartLabel = ` · ♥ ${b.cycle} ${b.lobe}`
    tray?.setToolTip(`◆ HERETIC — ${sessionRunning ? 'agent running' : 'idle'}${heartLabel}`)
    send(IPC.CARDIA_BEAT, b)
  }, 3000)
  const registered = globalShortcut.register('Alt+Space', summon)
  if (!registered) console.log('[heretic] Alt+Space hotkey not registered (taken by another app)')
  initUpdater((line) => console.log(line))

  ipcMain.handle(IPC.BRAINS_SCAN, async () => {
    const hits = await discoverLocal()
    return Promise.all(
      hits.map(async (h) => ({ ...h, residents: [...(await getResidents(h.baseUrl)) ?? []] }))
    )
  })

  ipcMain.handle(IPC.APPROVAL_DECIDE, (_e, { id, ok }: { id: number; ok: boolean }) => {
    pendingApprovals.get(id)?.(ok)
    pendingApprovals.delete(id)
  })

  let chatRunning = false
  ipcMain.handle(IPC.CHAT_STOP, () => {
    chatAbort?.abort()
    return { ok: true }
  })
  ipcMain.handle(IPC.SESSION_STOP, () => {
    sessionAbort?.abort()
    return { ok: true }
  })
  ipcMain.handle(IPC.WORKSPACE_PICK, async () => {
    const r = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: 'Workspace folder (persistent agent sandbox)',
      properties: ['openDirectory', 'createDirectory']
    })
    return { ok: !r.canceled, path: r.filePaths[0] ?? '' }
  })

  ipcMain.handle(IPC.BRAINS_SAVE, (_e, cfg: { url?: string; model?: string; key?: string; codexUrl?: string; codexModel?: string; workspace?: string }) => {
    try {
      const file = join(app.getPath('userData'), 'brains.json')
      const encrypted = Boolean(cfg.key) && safeStorage.isEncryptionAvailable()
      const keyEnc = cfg.key ? (encrypted ? safeStorage.encryptString(cfg.key).toString('base64') : cfg.key) : ''
      const prev = fsExists(join(app.getPath('userData'), 'brains.json'))
        ? (JSON.parse(readFileSync(join(app.getPath('userData'), 'brains.json'), 'utf-8')) as { workspace?: string })
        : {}
      const stored = { url: cfg.url ?? '', model: cfg.model ?? '', keyEnc, encrypted, codexUrl: cfg.codexUrl ?? '', codexModel: cfg.codexModel ?? '', workspace: cfg.workspace ?? prev.workspace ?? '' }
      writeFileSync(file, JSON.stringify(stored), 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.BRAINS_LOAD, () => {
    try {
      const file = join(app.getPath('userData'), 'brains.json')
      const raw = readFileSync(file, 'utf-8')
      const j = JSON.parse(raw) as { url?: string; model?: string; keyEnc?: string; encrypted?: boolean; codexUrl?: string; codexModel?: string; workspace?: string }
      let key = ''
      if (j.keyEnc) {
        key = j.encrypted && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(j.keyEnc, 'base64'))
          : j.keyEnc
      }
      return { ok: true, url: j.url ?? '', model: j.model ?? '', key, codexUrl: j.codexUrl ?? '', codexModel: j.codexModel ?? '', workspace: j.workspace ?? '' }
    } catch {
      return { ok: false, url: '', model: '', key: '' }
    }
  })
  ipcMain.handle(IPC.PERSONA_SAVE, (_e, persona: string) => {
    try {
      writeFileSync(join(app.getPath('userData'), 'persona.json'), JSON.stringify({ persona }), 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.PERSONA_LOAD, () => {
    try {
      const j = JSON.parse(readFileSync(join(app.getPath('userData'), 'persona.json'), 'utf-8')) as { persona?: string }
      return { ok: true, persona: j.persona ?? '' }
    } catch {
      return { ok: true, persona: '' }
    }
  })
  ipcMain.handle(IPC.ATTACH_PICK, async () => {
    const r = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      title: 'Attach images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, images: [] }
    const images = await Promise.all(
      r.filePaths.slice(0, 4).map(async (p) => {
        const ext = p.split('.').pop()?.toLowerCase() ?? 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'gif' ? 'gif' : ext === 'webp' ? 'webp' : 'png'
        const buf = await readFile(p)
        return `data:image/${mime};base64,${buf.toString('base64')}`
      })
    )
    return { ok: true, images }
  })

  ipcMain.handle(IPC.CHAT_SEND, async (_e, payload: ChatRequestPayload) => {
    if (chatRunning) return { answer: '', sources: [], error: 'chat busy' }
    chatRunning = true
    chatAbort = new AbortController()
    try {
      const r = await runChat({
        history: payload.history,
        brain: buildBrain(payload.brain),
        thinking: payload.thinking,
        web: payload.web,
        signal: chatAbort.signal,
        onDelta: (d) => send(IPC.CHAT_DELTA, { delta: d }),
        onStatus: (line) => send(IPC.CHAT_STATUS, { line })
      })
      return { answer: r.answer, sources: r.sources }
    } catch (e) {
      return { answer: '', sources: [], error: (e as Error).message }
    } finally {
      chatRunning = false
    }
  })

  ipcMain.handle(IPC.AUTO_SEND, async (_e, payload: AutoRequestPayload) => {
    if (chatRunning) return { kind: 'chat', answer: '', sources: [], error: 'busy' }
    chatRunning = true
    chatAbort = new AbortController()
    const lastUser = [...payload.history].reverse().find((m) => m.role === 'user')?.content ?? ''
    try {
      let mode: 'chat' | 'agent' = 'chat'
      let thinking: 'low' | 'mid' | 'high' | 'max' = 'mid'
      let web = false
      if (payload.auto) {
        const v = observe(lastUser)
        mode = v.mode
        thinking = v.thinking
        web = v.web
        send(IPC.CHAT_STATUS, { line: `observe: ${v.mode}${web ? ' · web' : ''} · ${v.thinking} (${v.reasons.join(', ')})` })
      }
      const codexBrain: BrainConfig | undefined =
        payload.brain.kind === 'openai' && payload.codexUrl
          ? { kind: 'openai', url: payload.codexUrl, model: payload.codexModel || 'default', key: payload.brain.key }
          : undefined
      if (mode === 'agent' && codexBrain) {
        send(IPC.CHAT_STATUS, { line: 'observe: codex brain — ' + (codexBrain.model ?? '') })
        const r = await runAgent(lastUser, {
          brain: buildBrain(codexBrain),
          persona: payload.persona,
          vaultRoot: VAULT_ROOT,
          tools: buildTools(),
          sandbox: new Sandbox(join(tmpdir(), `heretic-sandbox-${process.getuid?.() ?? 0}`)),
          policy: policyFor(payload.trust),
          maxSteps: 8,
          onStep: (s) =>
            send(IPC.CHAT_STATUS, {
              line: `${s.verdict === 'verified' ? '✓' : s.verdict === 'awaiting' ? '⚠' : '✗'} ${s.index} ${s.title} ${s.detail.split('\n')[0] ?? ''}${s.note ? ` [${s.note}]` : ''}`
            })
        })
        return { kind: 'agent', answer: r.final, sources: [], ok: r.ok }
      }
      const r = await runChat({
        history: payload.history,
        brain: buildBrain(payload.brain),
        thinking,
        web,
        persona: payload.persona,
        images: payload.images,
        searxng: web ? (await getSearxng()) ?? undefined : undefined,
        signal: chatAbort.signal,
        onDelta: (d) => send(IPC.CHAT_DELTA, { delta: d }),
        onStatus: (line) => send(IPC.CHAT_STATUS, { line })
      })
      return { kind: 'chat', answer: r.answer, sources: r.sources }
    } catch (e) {
      return { kind: 'chat', answer: '', sources: [], error: (e as Error).message }
    } finally {
      chatRunning = false
    }
  })

  ipcMain.handle(IPC.SESSION_RUN, async (_e, { task, brain, advisor, advisors, trust, root, workspace }: {
    task: string
    brain: BrainConfig
    advisor?: BrainConfig
    trust: TrustMode
    root?: string
    workspace?: string
    advisors?: BrainConfig[]
  }) => {
    if (sessionRunning) return { ok: false, error: 'session already running' }
    sessionRunning = true
    sessionAbort = new AbortController()
    tray?.setToolTip(`◆ HERETIC — agent running${heartLabel}`)
    const sandboxRoot = root ?? join(tmpdir(), `heretic-sandbox-${process.getuid?.() ?? 0}`)
    mkdirSync(sandboxRoot, { recursive: true })
    try {
      const tools = buildTools()
      const base = {
        persona: undefined as string | undefined,
        vaultRoot: VAULT_ROOT,
        tools,
        sandbox: new Sandbox(sandboxRoot),
        policy: policyFor(trust),
        maxSteps: 12,
        signal: sessionAbort!.signal,
        onStep: (step: import('../../../src/protocol/types').Step) => send(IPC.SESSION_STEP, step),
        onThinking: (t: string) => send(IPC.SESSION_THINKING, { text: t })
      }
      const council = advisor
        ? [{ brain: buildBrain(advisor), role: 'advisor' }]
        : (advisors ?? []).filter((a) => a.kind === 'echo' || a.url).map((a, i) => ({ brain: buildBrain(a), role: `advisor-${i + 1}` }))
      const result = council.length
        ? await runCouncil(task, { brain: buildBrain(brain), advisors: council, ...base })
        : await runAgent(task, { brain: buildBrain(brain), ...base })
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
      tray?.setToolTip(`◆ HERETIC — idle${heartLabel}`)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // tray keeps the app alive on all platforms
})
