// ═══════════════════════════════════════════════════════════
// HERETIC renderer — modern shell (Antigravity reference).
// Vanilla TS, zero frameworks. All brain stays in main via IPC.
// ═══════════════════════════════════════════════════════════

interface StepView {
  index: number
  kind: string
  title: string
  detail: string
  verdict: string
  note?: string
}

interface AutoApi {
  autoSend(payload: { history: { role: 'user' | 'assistant'; content: string }[]; brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }; trust: string; auto: boolean; persona?: string; images?: string[]; codexUrl?: string; codexModel?: string; workspace?: string; councilModels?: string[] }): Promise<{ kind: string; answer: string; sources: { title: string; url: string }[]; ok?: boolean; error?: string; tokens?: number; local?: boolean; replies?: { model: string; answer: string }[] }>
}

interface ChatApi extends AutoApi {
  chatSend(payload: { history: { role: 'user' | 'assistant'; content: string }[]; brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }; thinking: string; web: boolean }): Promise<{ answer: string; sources: { title: string; url: string }[]; error?: string }>
  onChatDelta(cb: (d: string) => void): () => void
  onChatStatus(cb: (line: string) => void): () => void
}

interface VoiceApi {
  voiceStatus(): Promise<{ available: boolean; reason: string }>
  voiceTranscribe(dataB64: string, mime: string): Promise<{ ok: boolean; text: string; error?: string }>
  onCardia(cb: (b: { cycle: number; lobe: 'A' | 'B'; lobeName: string }) => void): void
  pickWorkspace(): Promise<{ ok: boolean; path: string }>
  avatarDataUrl(): Promise<{ ok: boolean; dataUrl: string }>
  pickDocs(): Promise<{ ok: boolean; copied: string[] }>
  saveNote(title: string, text: string): Promise<{ ok: boolean; path: string }>
  addTask(text: string): Promise<{ ok: boolean; path: string }>
  exportChat(history: { role: string; content: string }[]): Promise<{ ok: boolean; path: string }>
  brainPing(cfg: { url?: string; model?: string; key?: string }): Promise<{ ok: boolean; ms: number; answer: string }>
  saveMcp(json: string): Promise<{ ok: boolean; tools: number; errors: string[] }>
  loadMcpConfig(): Promise<string>
}

interface PersonaApi extends VoiceApi {
  savePersona(persona: string): Promise<{ ok: boolean }>
  loadPersona(): Promise<{ ok: boolean; persona: string }>
  pickImages(): Promise<{ ok: boolean; images: string[] }>
}

interface StopApi extends PersonaApi {
  stopSession(): Promise<{ ok: boolean }>
  stopChat(): Promise<{ ok: boolean }>
  saveBrains(cfg: { url?: string; model?: string; key?: string; codexUrl?: string; codexModel?: string; workspace?: string }): Promise<{ ok: boolean }>
  loadBrains(): Promise<{ ok: boolean; url: string; model: string; key: string; codexUrl?: string; codexModel?: string; workspace?: string }>
  onThinking(cb: (t: string) => void): () => void
}

interface HereticApi extends ChatApi, StopApi {
  runSession(task: string, brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }, trust: string, advisor?: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }, advisors?: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }[]): Promise<{ ok: boolean; error?: string }>
  scanBrains(): Promise<{ name: string; baseUrl: string; models: string[]; residents?: string[] }[]>
  decideApproval(id: number, ok: boolean): Promise<void>
  onStep(cb: (s: StepView) => void): () => void
  onFinal(cb: (r: { ok: boolean; final: string }) => void): () => void
  onApproval(cb: (req: { id: number; action: string; detail: string; diff?: { path: string; before: string; after: string } }) => void): () => void
  askUser(question: string, options?: string[]): Promise<string>
  answerUser(id: number, answer: string): Promise<void>
  onAskUser(cb: (req: { id: number; question: string; options?: string[] }) => void): () => void
}

const api = (window as unknown as { heretic: HereticApi }).heretic

// Wrap the entire module body in a try-catch so initialization errors
// don't silently kill the app
const __initGuard = (fn: () => void): void => {
  try {
    fn()
  } catch (e) {
    showError(`[INIT] ${String(e)}`)
  }
}

// ── Safe DOM helpers: never crash on missing elements ─────
const __errors: string[] = []
const showError = (msg: string): void => {
  __errors.push(msg)
  if (__errors.length > 5) __errors.shift()
  let box = document.getElementById('__error-bar')
  if (!box) {
    box = document.createElement('div')
    box.id = '__error-bar'
    box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#2a0000;color:#ff6666;font:10px monospace;padding:4px 12px;border-top:1px solid #8b0000;max-height:60px;overflow-y:auto;white-space:pre-wrap;'
    document.body.appendChild(box)
  }
  box.textContent = __errors.join('\n')
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) {
    showError(`[DOM] missing #${id}`)
    return document.createElement('div') as unknown as T
  }
  return el as T
}

// ── Global error handlers ──────────────────────────────────
window.addEventListener('error', (e) => {
  showError(`[JS] ${e.message} @ ${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  showError(`[PROMISE] ${String(e.reason)}`)
})

// ── Safe event listener helper ─────────────────────────────
const on = (id: string, event: string, fn: EventListener): void => {
  const el = document.getElementById(id)
  if (!el) return // silently skip missing elements
  el.addEventListener(event, fn)
}
const ledger = $('ledger')
const chatLog = $('chatlog')

let selected: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } = { kind: 'echo' }
let running = false

const setBrainStatus = (text: string, connected: boolean): void => {
  ;($('brain-text') as HTMLElement).textContent = text.toUpperCase()
  ;($('conn-dot') as HTMLElement).className = `conn-dot ${connected ? 'on' : 'off'}`
  const hm = $('hdr-model')
  if (hm) hm.textContent = `MODEL: ${text.toUpperCase()}`
}

const scrollEnd = (el: HTMLElement): void => {
  el.scrollTop = el.scrollHeight
}

let avatarUrl = ''
const maybeAvatar = (el: HTMLElement | null): void => {
  if (!el || !avatarUrl) return
  el.innerHTML = ''
  const img = document.createElement('img')
  img.src = avatarUrl
  el.appendChild(img)
}
void api.avatarDataUrl().then((a) => {
  if (!a.ok || !a.dataUrl) return
  avatarUrl = a.dataUrl
  maybeAvatar(document.querySelector('.sidebar .avatar'))
  maybeAvatar(document.querySelector('.header .avatar'))
})

// ── avatar dup-guard ─────────────────────────────────────
void api.avatarDataUrl().then((a) => {
  if (!a.ok || !a.dataUrl) return
  const inject = (el: HTMLElement): void => {
    el.innerHTML = ''
    const img = document.createElement('img')
    img.src = a.dataUrl
    el.appendChild(img)
  }
  inject(document.querySelector('.sidebar .avatar') as HTMLElement)
  inject(document.querySelector('.header .avatar') as HTMLElement)
})

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    $('new-chat').click()
  }
})

// ── ask.user: the agent asks, the Principal answers ───────
api.onAskUser((req) => {
  const wrap = document.createElement('div')
  wrap.className = 'msg ai'
  wrap.style.borderColor = 'var(--dm-orange)'
  const header = document.createElement('div')
  header.className = 'msg-header'
  header.innerHTML = `<span class="msg-header-left"><span class="avatar">◆</span> ANATHEMETRON</span><span>ВОПРОС</span>`
  const body = document.createElement('div')
  body.className = 'msg-body'
  body.textContent = req.question
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;'
  const submit = (answer: string): void => {
    void api.answerUser(req.id, answer)
    body.textContent = `${req.question}\n→ ${answer}`
    actions.remove()
  }
  if (req.options?.length) {
    for (const opt of req.options.slice(0, 5)) {
      const btn = document.createElement('button')
      btn.className = 'dm-btn dm-btn-green dm-btn-small'
      btn.textContent = opt
      btn.addEventListener('click', () => submit(opt))
      actions.appendChild(btn)
    }
  }
  const input = document.createElement('input')
  input.className = 'dm-input'
  input.style.cssText = 'flex:1;min-width:150px;text-transform:none;'
  input.placeholder = 'Свободный ответ…'
  const send = document.createElement('button')
  send.className = 'dm-btn dm-btn-red dm-btn-small'
  send.textContent = 'ОТВЕТ'
  send.addEventListener('click', () => submit(input.value || '(пусто)'))
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit(input.value || '(пусто)')
  })
  actions.appendChild(input)
  actions.appendChild(send)
  wrap.appendChild(header)
  wrap.appendChild(body)
  wrap.appendChild(actions)
  chatLog.appendChild(wrap)
  scrollEnd(chatLog)
  input.focus()
})

// ── council panel (DIALOGUS TEAM reborn) ─────────────────
const renderCouncilList = (): void => {
  const box = $('council-list')
  const chip = $('model-chip') as HTMLSelectElement
  const models = [...chip.options].map((o) => o.value).filter(Boolean)
  box.innerHTML = ''
  if (!models.length) {
    box.innerHTML = '<div class="council-item" style="color:var(--dm-muted);cursor:default;">— scan для списка —</div>'
    return
  }
  for (const mm of models) {
    const label = document.createElement('label')
    label.className = 'council-item'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.value = mm
    const span = document.createElement('span')
    span.textContent = mm
    label.appendChild(cb)
    label.appendChild(span)
    box.appendChild(label)
  }
}

const councilSelection = (): string[] => {
  return [...document.querySelectorAll<HTMLInputElement>('#council-list input:checked')].map((i) => i.value)
}

// ── toggle buttons: DIALOGUS active state ────────────────
const syncToggle = (id: string): void => {
  const input = $(id) as HTMLInputElement
  const label = input.closest('.toggle-btn')
  label?.classList.toggle('active', input.checked)
}
syncToggle('auto')
syncToggle('web')
on('auto', 'change', () => syncToggle('auto'))
on('web', 'change', () => syncToggle('web'))

// ── prompt templates (DIALOGUS) ──────────────────────────
const TEMPLATES: Record<string, string> = {
  explain: 'Объясни подробно и структурировано:\n\n',
  refactor: 'Отрефактори следующий код, сохранив поведение, и объясни изменения:\n\n',
  test: 'Напиши тесты для следующего кода:\n\n',
  architect: 'Спроектируй архитектуру решения для задачи:\n\n',
  review: 'Проведи ревью кода и укажи проблемы по серьёзности:\n\n',
  summarize: 'Суммируй главное в следующем тексте:\n\n'
}
document.querySelectorAll<HTMLButtonElement>('.tpl').forEach((b) => {
  b.addEventListener('click', () => {
    const input = $('chat-input') as HTMLTextAreaElement
    input.value = (TEMPLATES[b.dataset.tpl ?? ''] ?? '') + input.value
    input.focus()
    input.selectionStart = input.value.length
  })
})

// ── scriptorium ──────────────────────────────────────────
const lastAnswer = (): string => {
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i]!.role === 'assistant') return chatHistory[i]!.content
  }
  return ''
}
on('save-note', 'click', () => {
  const text = lastAnswer()
  if (!text) { statusChip('✗ нет ответа для сохранения'); return }
  const title = (chatHistory.at(-2)?.content ?? 'note').slice(0, 40)
  void api.saveNote(title, text).then((r) => statusChip(r.ok ? `◆ писание сохранено: ${r.path}` : `✗ ${r.path}`))
})
on('create-task', 'click', () => {
  const text = lastAnswer().slice(0, 200) || (chatHistory.at(-1)?.content ?? '')
  if (!text) { statusChip('✗ пусто'); return }
  void api.addTask(text.replace(/\n/g, ' ')).then((r) => statusChip(r.ok ? `◆ задача в ledger: ${r.path}` : `✗ ${r.path}`))
})

// ── DOC button ───────────────────────────────────────────
on('export-md', 'click', () => {
  if (!chatHistory.length) { statusChip('✗ диалог пуст'); return }
  void api.exportChat(chatHistory.map((x) => ({ role: x.role, content: x.content }))).then((r) =>
    statusChip(r.ok ? `◆ диалог сохранён: ${r.path}` : '✗ отменено')
  )
})
on('brain-ping', 'click', () => {
  const btn = $('brain-ping') as HTMLButtonElement
  btn.textContent = '◆ ПРОВЕРЯЮ…'
  void api
    .brainPing({
      url: ($('c-url') as HTMLInputElement).value.trim() || undefined,
      model: ($('c-model') as HTMLInputElement).value.trim() || undefined,
      key: ($('c-key') as HTMLInputElement).value.trim() || undefined
    })
    .then((r) => {
      btn.textContent = '◆ ПРОВЕРКА СВЯЗИ'
      statusChip(r.ok ? `✓ связь есть: ${r.ms}мс · «${r.answer}»` : `✗ ${r.answer}`)
    })
})
void (async () => {
  try {
    const cfg = await api.loadMcpConfig()
    const box = $('mcp-json') as HTMLTextAreaElement | null
    if (box && cfg) box.value = cfg
  } catch {
    // first run
  }
})()
on('mcp-save', 'click', () => {
  const json = ($('mcp-json') as HTMLTextAreaElement).value
  void api.saveMcp(json).then((r) =>
    statusChip(
      r.ok
        ? `◆ MCP подключён: ${r.tools} инструментов${r.errors.length ? ' · ошибки: ' + r.errors.join('; ') : ''}`
        : `✗ MCP: ${r.errors.join('; ')}`
    )
  )
})

on('doc', 'click', () => {
  void api.pickDocs().then((r) => {
    if (r.ok && r.copied.length) {
      statusChip(`◆ документы в workspace-инбоксе: ${r.copied.join(', ')} (агент: fs.list inbox)`)
    }
  })
})

// ── token ledger ─────────────────────────────────────────
let tokTotal = 0
let tokLocal = 0
let tokCloud = 0
const renderTokens = (): void => {
  ;($('tok-total') as HTMLElement).textContent = tokTotal.toLocaleString('ru-RU')
  ;($('tok-local') as HTMLElement).textContent = tokLocal.toLocaleString('ru-RU')
  ;($('tok-cloud') as HTMLElement).textContent = tokCloud.toLocaleString('ru-RU')
}

// ── suggestion chips ─────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.suggest').forEach((b) => {
  b.addEventListener('click', () => {
    const input = $('chat-input') as HTMLInputElement
    input.value = b.dataset.q ?? ''
    input.focus()
  })
})

// ── settings modal ───────────────────────────────────────
on('settings-btn', 'click', () => {
  ;($('settings-modal') as HTMLElement).classList.remove('hidden')
  runScan()
})
on('settings-close', 'click', () => {
  persistBrains()
  ;($('settings-modal') as HTMLElement).classList.add('hidden')
  refreshBrainStatus()
})
on('council', 'change', () => {
  ;($('advisor-row') as HTMLElement).hidden = !($('council') as HTMLInputElement).checked
})

const refreshBrainStatus = (): void => {
  const url = ($('c-url') as HTMLInputElement).value.trim()
  const model = ($('model-chip') as HTMLSelectElement).value || ($('c-model') as HTMLInputElement).value.trim()
  const isEcho = !url
  setBrainStatus(isEcho ? 'echo · демо' : model || 'custom', !isEcho)
}

// auto-connect on boot: saved config wins, else discover
const autoConnect = async (): Promise<void> => {
  const saved = await api.loadBrains()
  if (saved.ok && saved.url) {
    refreshBrainStatus()
    return
  }
  try {
    const hits = await api.scanBrains()
    const h = hits[0]
    if (!h) {
      setBrainStatus('нет мозгов — echo демо', false)
      return
    }
    const res = h.residents ?? []
    const model = h.models.find((mm) => res.includes(mm)) ?? h.models[0] ?? 'default'
    ;($('c-url') as HTMLInputElement).value = h.baseUrl
    ;($('c-model') as HTMLInputElement).value = model
    selected = { kind: 'openai', url: h.baseUrl, model }
    setBrainStatus(`${model} ${res.includes(model) ? '◉' : ''}`.trim(), true)
    const chip = $('model-chip') as HTMLSelectElement
    chip.innerHTML = h.models
      .map((mm) => `<option value="${mm}">${res.includes(mm) ? '◉' : '○'} ${mm}</option>`)
      .join('')
    renderCouncilList()
    chip.value = model
  } catch {
    setBrainStatus('echo · демо', false)
  }
}

// ── theme ────────────────────────────────────────────────
const THEMES = ['mechanicus', 'light', 'dark'] as const
const applyTheme = (t: string): void => {
  document.documentElement.dataset.theme = t
  localStorage.setItem('heretic-theme', t)
}
applyTheme(localStorage.getItem('heretic-theme') ?? 'mechanicus')
on('theme', 'click', () => {
  const cur = document.documentElement.dataset.theme ?? 'mechanicus'
  applyTheme(THEMES[(THEMES.indexOf(cur as (typeof THEMES)[number]) + 1) % THEMES.length] ?? 'mechanicus')
})

// ── navigation ───────────────────────────────────────────
const showView = (id: 'chat' | 'agent'): void => {
  ;($('chatview') as HTMLElement).classList.toggle('hidden', id !== 'chat')
  ;($('agentview') as HTMLElement).classList.toggle('hidden', id !== 'agent')
  ;($('nav-chat') as HTMLElement).classList.toggle('active', id === 'chat')
  ;($('nav-agent') as HTMLElement).classList.toggle('active', id === 'agent')
}
on('nav-chat', 'click', () => showView('chat'))
on('nav-agent', 'click', () => showView('agent'))

// ── agent ledger ─────────────────────────────────────────
function ledgerCard(html: string): HTMLDivElement {
  const div = document.createElement('div')
  div.innerHTML = html
  ledger.appendChild(div)
  scrollEnd(ledger)
  return div
}

function renderStep(s: StepView): void {
  const verdict = s.verdict
  const title = s.kind === 'final' ? 'final answer' : s.title
  const note = s.note ? ` — ${s.note}` : ''
  ledgerCard(`
    <div class="step-card">
      <span class="v-${verdict}">${verdict === 'verified' ? '✓' : verdict === 'awaiting' ? '⚠' : '✗'}</span>
      <span class="n">${s.index}</span>
      <span class="t">${title}</span>
      <span class="d">${(s.detail || '').split('\n')[0] ?? ''}${note}</span>
      <span class="v-${verdict}">${verdict.toUpperCase()}</span>
    </div>`)
}

let thinkingLine: HTMLDivElement | null = null
api.onThinking((t) => {
  if (!thinkingLine) {
    thinkingLine = document.createElement('div')
    thinkingLine.className = 'status-line'
    thinkingLine.textContent = '◈ '
    ledger.appendChild(thinkingLine)
  }
  thinkingLine.textContent = '◈ ' + t.slice(-220)
  scrollEnd(ledger)
})
api.onStep((s) => {
  if (thinkingLine) {
    thinkingLine.remove()
    thinkingLine = null
  }
  renderStep(s)
})
api.onFinal((r) => {
  running = false
  if (thinkingLine) {
    thinkingLine.remove()
    thinkingLine = null
  }
  const btn = $('sendbtn-ignite') ?? $('ignite')
  btn.textContent = '◆'
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  ledgerCard(
    r.ok
      ? `<div class="final-card">${mdToHtml(r.final) || esc(r.final)}</div>`
      : `<div class="final-card" style="border-left-color:var(--dm-red-text);">✗ ${esc(r.final || 'session ended without a verified final answer')}</div>`
  )
})
api.onApproval((req) => {
  const diffHtml = req.diff
    ? `<div class="approval-diff"><div class="diff-path mono">${req.diff.path}</div>
       <pre class="diff-before">${req.diff.before || '(new file)'}</pre>
       <pre class="diff-after">${req.diff.after}</pre></div>`
    : ''
  const row = ledgerCard(`
    <div class="approval-card">
      <span class="grow"><b style="color:var(--dm-orange);">⚠ ${req.action}</b> <span class="d" style="font-size:9px;color:var(--dm-muted);">${req.detail}</span>${diffHtml}</span>
      <button class="dm-btn dm-btn-green dm-btn-small">APPROVE</button>
      <button class="dm-btn dm-btn-small">DENY</button>
    </div>`)
  const [ok, no] = row.querySelectorAll('button')
  ok?.addEventListener('click', () => {
    void api.decideApproval(req.id, true)
    row.remove()
  })
  no?.addEventListener('click', () => {
    void api.decideApproval(req.id, false)
    row.remove()
  })
})

// ── runtime scan ─────────────────────────────────────────
const runScan = (): void => {
  void (async () => {
    const list = $('brain-list')
    list.innerHTML = '<span class="dim small">scanning…</span>'
    const hits = await api.scanBrains()
    list.innerHTML = ''
    if (!hits.length) {
      list.innerHTML = '<span class="dim small">✗ no runtimes — use the fields below or the echo demo</span>'
      return
    }
    for (const h of hits) {
      const row = document.createElement('div')
      row.className = 'hit'
      const res = h.residents?.length ? h.residents.length : 0
      row.innerHTML = `${res ? '◉' : '○'} ${h.name}<span class="url">${h.baseUrl}${res ? ` · ${res} resident(s)` : ''}</span>`
      row.addEventListener('click', () => {
        const chosen = pickResidentFor(h).model
        const isResident = h.residents?.includes(chosen) ?? false
        if (h.residents && h.residents.length && !isResident) {
          const swap = window.confirm(
            `⚠ "${chosen}" не резидент — запрос выгрузит текущего резидента GPU (swap).\nВыбрать всё равно?`
          )
          if (!swap) return
        }
        selected = { kind: 'openai', url: h.baseUrl, model: chosen }
        ;($('c-url') as HTMLInputElement).value = h.baseUrl
        ;($('c-model') as HTMLInputElement).value = chosen
        refreshBrainStatus()
      })
      list.appendChild(row)
      const chip = $('model-chip') as HTMLSelectElement
      chip.innerHTML = h.models
        .map((m) => `<option value="${m}" ${h.residents?.includes(m) ? 'data-res="1"' : ''}>${h.residents?.includes(m) ? '◉' : '○'} ${m}</option>`)
        .join('')
    renderCouncilList()
      const firstRes = h.models.find((m) => h.residents?.includes(m))
      if (firstRes) chip.value = firstRes
    }
  })()
}
on('model-chip', 'change', () => {
  const chip = $('model-chip') as HTMLSelectElement
  if (!chip.value) return
  const url = ($('c-url') as HTMLInputElement).value.trim()
  if (url) {
    selected = { kind: 'openai', url, model: chip.value }
    ;($('c-model') as HTMLInputElement).value = chip.value
    refreshBrainStatus()
  }
})

const pickResidentFor = (h: { models: string[]; residents?: string[] }): { model: string } => {
  const models = h.models ?? []
  const residents = h.residents ?? []
  const hit = models.find((m) => residents.includes(m))
  return { model: hit ?? models[0] ?? 'default' }
}

const councilBox = $('council') as HTMLInputElement
councilBox.addEventListener('change', () => {
  ;($('advisor-row') as HTMLElement).hidden = !councilBox.checked
})

// ── agent ignition ───────────────────────────────────────
on('ignite', 'click', () => {
  if (running) {
    if (($('ignite') as HTMLElement).classList.contains('stopping')) void api.stopSession()
    return
  }
  const task = ($('task') as HTMLInputElement).value.trim()
  if (!task) return

  const url = ($('c-url') as HTMLInputElement).value.trim()
  if (url) {
    const model = ($('c-model') as HTMLInputElement).value.trim()
    const key = ($('c-key') as HTMLInputElement).value.trim()
    selected = { kind: 'openai', url, model: model || 'default', key: key || undefined }
  }
  setBrainStatus(selected.kind === 'echo' ? 'echo · демо' : selected.model ?? 'custom', selected.kind !== 'echo')

  let advisor: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } | undefined
  let advisors: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }[] | undefined
  if (councilBox.checked) {
    const aUrl = ($('a-url') as HTMLInputElement).value.trim()
    const aModel = ($('a-model') as HTMLInputElement).value.trim()
    const aKey = ($('a-key') as HTMLInputElement).value.trim()
    advisor =
      !aUrl || aUrl === 'echo'
        ? { kind: 'echo' }
        : { kind: 'openai', url: aUrl, model: aModel || 'default', key: aKey || undefined }
    // multi-advisor: a-model accepts comma-separated model ids on the same endpoint
    if (aUrl && aUrl !== 'echo' && aModel.includes(',')) {
      advisors = aModel
        .split(',')
        .map((mm) => mm.trim())
        .filter(Boolean)
        .map((mm) => ({ kind: 'openai' as const, url: aUrl, model: mm, key: aKey || undefined }))
    }
  }

  running = true
  const igniteBtn = $('ignite') as HTMLElement
  igniteBtn.textContent = '■'
  igniteBtn.title = 'stop'
  igniteBtn.classList.add('stopping')
  ledger.innerHTML = ''
  ledgerCard(
    `<div class="status-line observe">◆ SESSION START · TRUST=${($('trust') as HTMLSelectElement).value.toUpperCase()}${advisor ? ' · COUNCIL' : ''}</div>`
  )
  void api.runSession(task, selected, ($('trust') as HTMLSelectElement).value, advisor, advisors).then(() => {
    igniteBtn.textContent = '◆'
    igniteBtn.title = 'ignite'
    igniteBtn.classList.remove('stopping')
  })
})

on('task', 'keydown', (e: Event) => {
  if ((e as KeyboardEvent).key === 'Enter') ($('ignite') as HTMLElement).click()
})


// ── markdown (DIALOGUS lineage, zero-dep, CSP-safe) ──────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mdToHtml(src: string): string {
  const pres: string[] = []
  let s = escapeHtml(src)
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    pres.push(`<pre><code>${String(code).replace(/\n$/, '')}</code></pre>`)
    return `\u0000PRE${pres.length - 1}\u0000`
  })
  s = s
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
  s = s
    .split(/\n\n+/)
    .map((block) => (block.startsWith('<h') || block.startsWith('<li') || block.startsWith('<pre') || block.includes('\u0000PRE') ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`))
    .join('\n')
  return s.replace(/\u0000PRE(\d+)\u0000/g, (_m, i: string) => pres[Number(i)] ?? '')
}

// ── chat (AUTO surface) ──────────────────────────────────
const chatHistory: { role: 'user' | 'assistant'; content: string }[] = []
let chatBusy = false

const chatNode = (el: HTMLElement): HTMLElement => {
  chatLog.appendChild(el)
  scrollEnd(chatLog)
  return el
}

const statusChip = (text: string, observe = false): void => {
  const div = document.createElement('div')
  div.className = `status-line${observe ? ' observe' : ''}`
  div.textContent = text
  chatNode(div)
}

const bubbleActions = (idx: number, text: string): HTMLDivElement => {
  const row = document.createElement('div')
  row.className = 'bubble-actions'
  const mk = (label: string, title: string, fn: () => void): void => {
    const b = document.createElement('button')
    b.className = 'act'
    b.textContent = label
    b.title = title
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      fn()
    })
    row.appendChild(b)
  }
  mk('✎', 'edit and re-ask from here', () => {
    chatHistory.length = idx
    rerenderFromHistory()
    const input = $('chat-input') as HTMLInputElement
    input.value = text
    input.focus()
  })
  mk('↻', 'regenerate this answer', () => {
    if (chatBusy) return
    chatHistory.length = idx + 1
    rerenderFromHistory()
    dispatch([])
  })
  mk('⑂', 'branch: new session from this point', () => {
    const copy = chatHistory.slice(0, idx + 1).map((m) => ({ role: m.role, content: m.content }))
    currentSessionId = null
    chatHistory.length = 0
    chatHistory.push(...copy)
    rerenderFromHistory()
    persistCurrentSession()
    renderSessionSelect()
  })
  return row
}

const stamp = (): string => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

const userBubble = (text: string, images: string[] = [], idx = -1): void => {
  const div = document.createElement('div')
  div.className = 'msg user'
  const header = document.createElement('div')
  header.className = 'msg-header'
  header.innerHTML = `<span class="msg-header-left"><span class="avatar">&#9670;</span> ПРИНЦИПАЛ</span><span>${stamp()}</span>`
  void maybeAvatar(header.querySelector('.avatar') as HTMLElement)
  div.appendChild(header)
  const body = document.createElement('div')
  body.className = 'msg-body'
  body.textContent = text
  div.appendChild(body)
  if (images.length) {
    const strip = document.createElement('div')
    for (const u of images) {
      const im = document.createElement('img')
      im.src = u
      im.className = 'msg-image'
      strip.appendChild(im)
    }
    body.appendChild(strip)
  }
  if (idx >= 0) {
    const actions = bubbleActions(idx, text)
    actions.classList.add('msg-actions')
    header.appendChild(actions)
  }
  chatNode(div)
}

const aiMessage = (): HTMLDivElement => {
  const wrap = document.createElement('div')
  wrap.className = 'msg ai'
  wrap.innerHTML = `
    <div class="msg-header">
      <span class="msg-header-left"><span class="avatar">&#9670;</span> ANATHEMETRON</span>
      <span>${stamp()}</span>
    </div>
    <div class="msg-body"></div>`
  void maybeAvatar(wrap.querySelector('.avatar') as HTMLElement)
  chatNode(wrap)
  return wrap.querySelector('.msg-body') as HTMLDivElement
}

let streamTarget: HTMLDivElement | null = null
let streamText = ''
api.onChatDelta((d) => {
  if (!streamTarget) return
  streamText += d
  streamTarget.textContent = streamText
  scrollEnd(chatLog)
})
api.onChatStatus((line) => {
  const observe = line.startsWith('observe:')
  const glyph = line.startsWith('observe:') ? '⚙' : line.startsWith('✓') || line.startsWith('✗') ? '' : '·'
  statusChip(`${glyph ? glyph + ' ' : ''}${line}`, observe)
})

const currentBrain = (): { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } => {
  const url = ($('c-url') as HTMLInputElement).value.trim()
  if (url) {
    return {
      kind: 'openai',
      url,
      model: ($('c-model') as HTMLInputElement).value.trim() || 'default',
      key: ($('c-key') as HTMLInputElement).value.trim() || undefined
    }
  }
  return selected
}

const rerenderFromHistory = (): void => {
  chatLog.innerHTML = ''
  chatHistory.forEach((m, i) => {
    if (m.role === 'user') userBubble(m.content, [], i)
    else {
      const body = aiMessage()
      body.innerHTML = mdToHtml(m.content) || ''
    }
  })
  scrollEnd(chatLog)
}

const dispatch = (images: string[]): void => {
  streamTarget = aiMessage()
  streamText = ''
  chatBusy = true
  const sendBtn = $('send') as HTMLButtonElement
  sendBtn.classList.add('stopping')
  sendBtn.onclick = () => void api.stopChat()
  void api
    .autoSend({
      history: chatHistory.map((m) => ({ role: m.role, content: m.content })),
      brain: currentBrain(),
      trust: ($('trust') as HTMLSelectElement).value,
      auto: ($('auto') as HTMLInputElement).checked,
      persona: persona || undefined,
      images: images.length ? images : undefined,
      councilModels: councilSelection().length >= 2 ? councilSelection() : undefined,
      codexUrl: ($('cx-url') as HTMLInputElement).value.trim() || undefined,
      codexModel: ($('cx-model') as HTMLInputElement).value.trim() || undefined,
      workspace: ($('ws-path') as HTMLInputElement).value.trim() || undefined
    })
    .then((r) => {
      chatBusy = false
      sendBtn.classList.remove('stopping')
      sendBtn.onclick = null
      if (r.error) {
        streamTarget!.textContent = `✗ ${r.error}`
        streamTarget = null
        return
      }
      if (r.kind === 'council' && r.replies?.length) {
        streamTarget!.closest('.msg')?.remove()
        for (const reply of r.replies) {
          const body = aiMessage()
          const nameEl = body.closest('.msg')?.querySelector('.msg-header-left')
          if (nameEl) nameEl.textContent += ` · ${reply.model}`
          body.innerHTML = mdToHtml(reply.answer) || ''
        }
      } else if (!streamText && r.answer) {
        streamTarget!.textContent =
          r.kind === 'agent' ? `${r.ok ? '⚙ session complete' : '✗ no verified final answer'}\n\n${r.answer}` : r.answer
      }
      if (r.kind !== 'council' && r.answer) streamTarget!.innerHTML = mdToHtml(r.answer) || streamTarget!.innerHTML
      if (r.sources.length) {
        const box = document.createElement('div')
        box.className = 'sources'
        box.innerHTML =
          '<div class="dm-label" style="margin-bottom:4px;">&#9670; SOURCES</div>' +
          r.sources.map((sr, i) => `<div class="source-item">[${i + 1}] <a href="${sr.url}" target="_blank" rel="noopener">${sr.title}</a></div>`).join('')
        chatNode(box)
      }
      if (r.tokens) {
        tokTotal += r.tokens
        if (r.local) tokLocal += r.tokens
        else tokCloud += r.tokens
        renderTokens()
      }
      chatHistory.push({ role: 'assistant', content: r.kind === 'council' ? (r.replies ?? []).map((x) => `[${x.model}] ${x.answer}`).join('\n\n---\n\n') : r.answer })
      persistCurrentSession()
      streamTarget = null
    })
}

const inputEl = $('chat-input') as HTMLTextAreaElement
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px'
})

const sendChat = (): void => {
  if (chatBusy) return
  const input = $('chat-input') as HTMLInputElement
  const q = input.value.trim()
  if (!q) return
  input.value = ''
  inputEl.style.height = 'auto'
  const emptyHero = chatLog.querySelector('.empty-state')
  if (emptyHero) emptyHero.remove()
  const images = attached.slice()
  attached = []
  renderAttached()
  persistBrains()
  userBubble(q, images, chatHistory.length)
  chatHistory.push({ role: 'user', content: q })
  dispatch(images)
}

// ── persona ──────────────────────────────────────────────
let persona = ''
api.onCardia((b) => {
  const chip = $('cardia')
  chip.classList.remove('hidden')
  chip.textContent = `♥ ${b.cycle} · ${b.lobe}`
  chip.classList.remove('beat')
  void chip.offsetWidth
  chip.classList.add('beat')
})
void api.loadPersona().then((p) => {
  persona = p.persona
  ;($('persona-text') as HTMLTextAreaElement).value = persona
})
on('persona-btn', 'click', () => ($('persona-modal') as HTMLElement).classList.remove('hidden'))
on('persona-close', 'click', () => ($('persona-modal') as HTMLElement).classList.add('hidden'))
on('persona-save', 'click', () => {
  persona = ($('persona-text') as HTMLTextAreaElement).value.trim()
  void api.savePersona(persona)
  ;($('persona-modal') as HTMLElement).classList.add('hidden')
})

// ── workspace ────────────────────────────────────────────
on('ws-pick', 'click', () => {
  void api.pickWorkspace().then((r) => {
    if (r.ok && r.path) {
      ;($('ws-path') as HTMLInputElement).value = r.path
      persistBrains()
    }
  })
})

// ── attachments ──────────────────────────────────────────
let attached: string[] = []
const renderAttached = (): void => {
  const box = $('attach-preview')
  box.innerHTML = ''
  attached.forEach((dataUrl, i) => {
    const chip = document.createElement('div')
    chip.className = 'attachment-chip'
    const img = document.createElement('img')
    img.src = dataUrl
    const x = document.createElement('button')
    x.textContent = '✕'
    x.addEventListener('click', () => {
      attached.splice(i, 1)
      renderAttached()
    })
    chip.appendChild(img)
    chip.appendChild(x)
    box.appendChild(chip)
  })
}
on('attach', 'click', () => {
  void api.pickImages().then((r) => {
    if (r.ok && r.images.length) {
      attached = [...attached, ...r.images].slice(0, 4)
      renderAttached()
    }
  })
})

// ── voice (whisper organ) ────────────────────────────────
void api.voiceStatus().then((v) => {
  if (v.available) $('mic').classList.remove('hidden')
})
let rec: MediaRecorder | null = null
let recChunks: Blob[] = []
on('mic', 'click', () => {
  if (rec) {
    rec.stop()
    return
  }
  void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    rec = new MediaRecorder(stream)
    recChunks = []
    $('mic').classList.add('rec')
    rec.ondataavailable = (e) => recChunks.push(e.data)
    rec.onstop = () => {
      $('mic').classList.remove('rec')
      stream.getTracks().forEach((t) => t.stop())
      rec = null
      const blob = new Blob(recChunks, { type: 'audio/webm' })
      const reader = new FileReader()
      reader.onloadend = () => {
        const b64 = String(reader.result).split(',')[1] ?? ''
        ;($('mic') as HTMLElement).textContent = '○'
        void api.voiceTranscribe(b64, 'audio/webm').then((r) => {
          ;($('mic') as HTMLElement).textContent = '●'
          if (r.ok && r.text) {
            const input = $('chat-input') as HTMLInputElement
            input.value = (input.value ? input.value + ' ' : '') + r.text
            input.focus()
          } else if (r.error) {
            statusChip(`✗ voice: ${r.error}`)
          }
        })
      }
      reader.readAsDataURL(blob)
    }
    rec.start()
  }).catch((e) => statusChip(`✗ mic: ${String(e)}`))
})

// ── sessions ─────────────────────────────────────────────
interface StoredSession { id: string; name: string; updated: number; history: { role: 'user' | 'assistant'; content: string }[]; model?: string }

const loadSessions = (): StoredSession[] => {
  try {
    return JSON.parse(localStorage.getItem('heretic-sessions') ?? '[]') as StoredSession[]
  } catch {
    return []
  }
}
const saveSessions = (all: StoredSession[]): void => {
  let payload = JSON.stringify(all.slice(-20))
  try {
    localStorage.setItem('heretic-sessions', payload)
  } catch {
    // quota exceeded — drop the oldest half and retry once
    const half = all.slice(-Math.max(4, Math.floor(all.length / 2)))
    payload = JSON.stringify(half)
    try {
      localStorage.setItem('heretic-sessions', payload)
    } catch {
      // give up silently — sessions are a convenience, never a crash
    }
  }
}

let currentSessionId: string | null = null

const renderSessionSelect = (): void => {
  const box = $('session-list')
  if (!box) return
  const filter = ($('session-filter') as HTMLInputElement)?.value.trim().toLowerCase() ?? ''
  const all = [...loadSessions()].reverse().filter((x) => !filter || x.name.toLowerCase().includes(filter))
  box.innerHTML = ''
  if (!all.length) {
    box.innerHTML = '<div class="session-item" style="cursor:default;color:var(--dm-muted);">— нет записанных диалогов —</div>'
    return
  }
  for (const ses of all.slice(0, 30)) {
    const item = document.createElement('div')
    item.className = `session-item${ses.id === currentSessionId ? ' active' : ''}`
    item.innerHTML = `<div class="session-title">${ses.name}</div><div class="session-meta">${ses.model ?? '—'} · ${ses.history.length} сообщ.</div><button class="rm msg-action" title="удалить">✕</button>`
    item.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      if (t.classList.contains('rm')) {
        saveSessions(loadSessions().filter((x) => x.id !== ses.id))
        if (currentSessionId === ses.id) {
          currentSessionId = null
          chatHistory.length = 0
          rerenderFromHistory()
        }
        renderSessionSelect()
        return
      }
      restoreSession(ses.id)
    })
    item.addEventListener('dblclick', () => {
      const name = window.prompt('Переименовать диалог:', ses.name)
      if (name) {
        const all2 = loadSessions()
        const found = all2.find((x) => x.id === ses.id)
        if (found) {
          found.name = name.slice(0, 40)
          saveSessions(all2)
          renderSessionSelect()
        }
      }
    })
    box.appendChild(item)
  }
}

on('session-filter', 'input', (): void => renderSessionSelect())

const persistCurrentSession = (): void => {
  if (!chatHistory.length) return
  const all = loadSessions()
  const id = currentSessionId ?? `s-${Date.now()}`
  currentSessionId = id
  const name = (chatHistory.find((m) => m.role === 'user')?.content ?? 'session').slice(0, 28)
  const existing = all.findIndex((s) => s.id === id)
  const model = ($('model-chip') as HTMLSelectElement).value || ($('c-model') as HTMLInputElement).value.trim() || '—'
  const entry: StoredSession = { id, name, updated: Date.now(), history: [...chatHistory], model }
  if (existing >= 0) all[existing] = entry
  else all.push(entry)
  saveSessions(all)
  renderSessionSelect()
}

const restoreSession = (id: string): void => {
  const s = loadSessions().find((x) => x.id === id)
  if (!s) return
  currentSessionId = id
  chatHistory.length = 0
  chatLog.innerHTML = ''
  for (const m of s.history) {
    if (m.role === 'user') userBubble(m.content)
    else {
      const body = aiMessage()
      body.innerHTML = mdToHtml(m.content)
    }
  }
  scrollEnd(chatLog)
}

on('new-chat', 'click', () => {
  currentSessionId = null
  chatHistory.length = 0
  chatLog.innerHTML = '<div class="empty-state"><div class="glyph">&#9670;</div><h2>НОВЫЙ ДИАЛОГ</h2><p>Спроси что угодно — или доверь задачу.</p></div>'
  renderSessionSelect()
})

renderSessionSelect()

// ── boot: restore config, then auto-connect the organism ──
void (async () => {
  const b = await api.loadBrains()
  if (b.ok && b.url) {
    ;($('c-url') as HTMLInputElement).value = b.url
    ;($('c-model') as HTMLInputElement).value = b.model
    ;($('c-key') as HTMLInputElement).value = b.key
    if (b.codexUrl) ($('cx-url') as HTMLInputElement).value = b.codexUrl
    if (b.codexModel) ($('cx-model') as HTMLInputElement).value = b.codexModel
    if (b.workspace) ($('ws-path') as HTMLInputElement).value = b.workspace
  }
  refreshBrainStatus()
  await autoConnect()
  const last = [...loadSessions()].sort((a, b) => b.updated - a.updated)[0]
  if (last && last.history.length) restoreSession(last.id)
})()

const persistBrains = (): void => {
  void api.saveBrains({
    url: ($('c-url') as HTMLInputElement).value.trim(),
    model: ($('c-model') as HTMLInputElement).value.trim(),
    key: ($('c-key') as HTMLInputElement).value.trim(),
    codexUrl: ($('cx-url') as HTMLInputElement).value.trim(),
    codexModel: ($('cx-model') as HTMLInputElement).value.trim(),
    workspace: ($('ws-path') as HTMLInputElement).value.trim()
  })
}
on('send', 'click', () => {
  if (($('send') as HTMLElement).classList.contains('stopping')) return
  persistBrains()
  sendChat()
})
on('chat-input', 'keydown', (e: Event) => {
  const ke = e as KeyboardEvent
  if (ke.key === 'Enter' && !ke.shiftKey) {
    ke.preventDefault()
    sendChat()
  }
})
