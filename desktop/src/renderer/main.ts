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
  autoSend(payload: { history: { role: 'user' | 'assistant'; content: string }[]; brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }; trust: string; auto: boolean }): Promise<{ kind: string; answer: string; sources: { title: string; url: string }[]; ok?: boolean; error?: string }>
}

interface ChatApi extends AutoApi {
  chatSend(payload: { history: { role: 'user' | 'assistant'; content: string }[]; brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }; thinking: string; web: boolean }): Promise<{ answer: string; sources: { title: string; url: string }[]; error?: string }>
  onChatDelta(cb: (d: string) => void): () => void
  onChatStatus(cb: (line: string) => void): () => void
}

interface HereticApi extends ChatApi {
  runSession(task: string, brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }, trust: string, advisor?: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }): Promise<{ ok: boolean; error?: string }>
  scanBrains(): Promise<{ name: string; baseUrl: string; models: string[] }[]>
  decideApproval(id: number, ok: boolean): Promise<void>
  onStep(cb: (s: StepView) => void): () => void
  onFinal(cb: (r: { ok: boolean; final: string }) => void): () => void
  onApproval(cb: (req: { id: number; action: string; detail: string }) => void): () => void
}

const api = (window as unknown as { heretic: HereticApi }).heretic

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const ledger = $('ledger')
const chatLog = $('chatlog')

let selected: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } = { kind: 'echo' }
let running = false

const scrollEnd = (el: HTMLElement): void => {
  el.scrollTop = el.scrollHeight
}

// ── theme ────────────────────────────────────────────────
const applyTheme = (t: string): void => {
  document.documentElement.dataset.theme = t
  localStorage.setItem('heretic-theme', t)
}
applyTheme(localStorage.getItem('heretic-theme') ?? 'light')
$('theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
})

// ── navigation ───────────────────────────────────────────
const showView = (id: 'chat' | 'agent'): void => {
  ;($('chatview') as HTMLElement).classList.toggle('hidden', id !== 'chat')
  ;($('agentview') as HTMLElement).classList.toggle('hidden', id !== 'agent')
  ;($('nav-chat') as HTMLElement).classList.toggle('active', id === 'chat')
  ;($('nav-agent') as HTMLElement).classList.toggle('active', id === 'agent')
}
$('nav-chat').addEventListener('click', () => showView('chat'))
$('nav-agent').addEventListener('click', () => showView('agent'))

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
    <div class="step-card ${verdict}">
      <span class="step-dot"></span>
      <span class="step-index">${s.index}</span>
      <span class="step-title">${title}</span>
      <span class="step-detail">${(s.detail || '').split('\n')[0] ?? ''}${note}</span>
      <span class="verdict-pill">${verdict}</span>
    </div>`)
}

api.onStep(renderStep)
api.onFinal((r) => {
  running = false
  const btn = $('sendbtn-ignite') ?? $('ignite')
  btn.textContent = '◆'
  ledgerCard(
    r.ok
      ? `<div class="final-card">${r.final}</div>`
      : `<div class="final-card bad">${r.final || 'session ended without a verified final answer'}</div>`
  )
})
api.onApproval((req) => {
  const row = ledgerCard(`
    <div class="approval-card">
      <span class="step-dot" style="background: var(--warn)"></span>
      <span class="grow"><b>${req.action}</b> <span class="dim small mono">${req.detail}</span></span>
      <button class="approve-btn">Approve</button>
      <button class="deny-btn">Deny</button>
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
$('scan').addEventListener('click', () => {
  void (async () => {
    ;($('brains') as HTMLElement).hidden = false
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
      row.innerHTML = `◉ ${h.name}<span class="url">${h.baseUrl}</span>`
      row.addEventListener('click', () => {
        selected = { kind: 'openai', url: h.baseUrl, model: h.models[0] ?? 'default' }
        ;($('brain-label') as HTMLElement).textContent = `${h.name} · ${selected.model ?? ''}`
        ;($('c-url') as HTMLInputElement).value = h.baseUrl
      })
      list.appendChild(row)
    }
  })()
})

const councilBox = $('council') as HTMLInputElement
councilBox.addEventListener('change', () => {
  ;($('advisor-row') as HTMLElement).hidden = !councilBox.checked
})

// ── agent ignition ───────────────────────────────────────
$('ignite').addEventListener('click', () => {
  if (running) return
  const task = ($('task') as HTMLInputElement).value.trim()
  if (!task) return

  const url = ($('c-url') as HTMLInputElement).value.trim()
  if (url) {
    const model = ($('c-model') as HTMLInputElement).value.trim()
    const key = ($('c-key') as HTMLInputElement).value.trim()
    selected = { kind: 'openai', url, model: model || 'default', key: key || undefined }
  }
  ;($('brain-label') as HTMLElement).textContent =
    selected.kind === 'echo' ? 'echo · demo' : `${selected.model ?? 'custom'}`

  let advisor: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } | undefined
  if (councilBox.checked) {
    const aUrl = ($('a-url') as HTMLInputElement).value.trim()
    advisor =
      !aUrl || aUrl === 'echo'
        ? { kind: 'echo' }
        : {
            kind: 'openai',
            url: aUrl,
            model: ($('a-model') as HTMLInputElement).value.trim() || 'default',
            key: ($('a-key') as HTMLInputElement).value.trim() || undefined
          }
  }

  running = true
  ;($('ignite') as HTMLElement).textContent = advisor ? '⧉' : '···'
  ledger.innerHTML = ''
  ledgerCard(
    `<div class="status-chip">session start · trust=${($('trust') as HTMLSelectElement).value}${advisor ? ' · council' : ''}</div>`
  )
  void api.runSession(task, selected, ($('trust') as HTMLSelectElement).value, advisor)
})

$('task').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('ignite').click()
})

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
  div.className = `status-chip${observe ? ' observe' : ''}`
  div.textContent = text
  chatNode(div)
}

const userBubble = (text: string): void => {
  const div = document.createElement('div')
  div.className = 'msg-user'
  div.textContent = text
  chatNode(div)
}

const aiMessage = (): HTMLDivElement => {
  const wrap = document.createElement('div')
  wrap.className = 'msg-ai'
  wrap.innerHTML = `
    <div class="avatar">◆</div>
    <div class="msg-body">
      <div class="msg-name">ANATHEMETRON</div>
      <div class="msg-content"></div>
    </div>`
  chatNode(wrap)
  return wrap.querySelector('.msg-content') as HTMLDivElement
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

const sendChat = (): void => {
  if (chatBusy) return
  const input = $('chat-input') as HTMLInputElement
  const q = input.value.trim()
  if (!q) return
  input.value = ''
  const emptyHero = chatLog.querySelector('.empty')
  if (emptyHero) emptyHero.remove()
  userBubble(q)
  chatHistory.push({ role: 'user', content: q })
  streamTarget = aiMessage()
  streamText = ''
  chatBusy = true
  ;($('send') as HTMLButtonElement).disabled = true
  void api
    .autoSend({
      history: [...chatHistory],
      brain: currentBrain(),
      trust: ($('trust') as HTMLSelectElement).value,
      auto: ($('auto') as HTMLInputElement).checked
    })
    .then((r) => {
      chatBusy = false
      ;($('send') as HTMLButtonElement).disabled = false
      if (r.error) {
        streamTarget!.textContent = `✗ ${r.error}`
        streamTarget = null
        return
      }
      if (!streamText && r.answer) {
        streamTarget!.textContent =
          r.kind === 'agent' ? `${r.ok ? '⚙ session complete' : '✗ no verified final answer'}\n\n${r.answer}` : r.answer
      }
      if (r.sources.length) {
        const box = document.createElement('div')
        box.className = 'sources'
        box.innerHTML = r.sources
          .map((s, i) => `<div class="source-link">[${i + 1}] <b>${s.title}</b> — ${s.url}</div>`)
          .join('')
        chatNode(box)
      }
      chatHistory.push({ role: 'assistant', content: r.answer })
      streamTarget = null
    })
}
$('send').addEventListener('click', sendChat)
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat()
})
