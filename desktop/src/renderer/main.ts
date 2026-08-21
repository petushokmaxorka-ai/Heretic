// HERETIC renderer — the ledger face. Vanilla TS, zero frameworks.

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

let selected: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string } = { kind: 'echo' }
let running = false

function line(html: string): HTMLDivElement {
  const div = document.createElement('div')
  div.innerHTML = html
  ledger.appendChild(div)
  ledger.scrollTop = ledger.scrollHeight
  return div
}

function renderStep(s: StepView): void {
  const g = s.verdict === 'verified' ? '✓' : s.verdict === 'awaiting' ? '⚠' : '✗'
  const cls = s.verdict === 'verified' ? 'ok' : s.verdict === 'awaiting' ? 'warn' : 'bad'
  const head = s.kind === 'final' ? '<span class="ok">◆</span>' : `<span class="${cls}">${g}</span>`
  const note = s.note ? ` <span class="note">[${s.note}]</span>` : ''
  line(`<div class="step">${head}<span class="idx">${s.index}</span>${s.title} <span class="detail">${s.detail}</span>${note}</div>`)
}

api.onStep(renderStep)
api.onFinal((r) => {
  running = false
  $('ignite').textContent = 'IGNITE'
  if (r.ok) line(`<div class="final-line">◆ ${r.final}</div>`)
  else line(`<div class="final-line bad">✗ ${r.final || 'session ended'}</div>`)
})
api.onApproval((req) => {
  const row = line(
    `<div class="approval"><span class="warn">⚠</span><span>${req.action}</span><span class="dim small">${req.detail}</span>
     <button class="approve" data-a="1">approve</button><button data-a="0">deny</button></div>`
  )
  row.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      void api.decideApproval(req.id, b.dataset.a === '1')
      row.remove()
    })
  )
})

$('scan').addEventListener('click', () => {
  void (async () => {
    $('brains').hidden = false
    const list = $('brain-list')
    list.innerHTML = '<span class="dim small">scanning…</span>'
    const hits = await api.scanBrains()
    list.innerHTML = ''
    if (!hits.length) {
      list.innerHTML = '<span class="bad small">✗ no runtimes — use custom fields or the echo demo</span>'
      return
    }
    for (const h of hits) {
      const row = document.createElement('div')
      row.className = 'hit'
      row.innerHTML = `✓ ${h.name}<span class="url">${h.baseUrl}</span>`
      row.addEventListener('click', () => {
        selected = { kind: 'openai', url: h.baseUrl, model: h.models[0] ?? 'default' }
        $('brain-label').textContent = `brain: ${h.name} · ${selected.model ?? ''}`
        ;($('c-url') as HTMLInputElement).value = h.baseUrl
      })
      list.appendChild(row)
    }
  })()
})

const councilBox = $('council') as HTMLInputElement
councilBox.addEventListener('change', () => {
  ($('advisor-row') as HTMLElement).hidden = !councilBox.checked
})

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
  if (selected.kind === 'echo' && !$('brains').hidden) {
    // echo only if explicitly nothing chosen
  }
  $('brain-label').textContent = `brain: ${selected.kind === 'echo' ? 'echo (demo)' : selected.model ?? 'custom'}`

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
  $('ignite').textContent = advisor ? 'COUNCIL' : 'RUNNING'
  ledger.innerHTML = ''
  line(`<div class="step dim">◆ session start · trust=${($('trust') as HTMLSelectElement).value}</div>`)
  void api.runSession(task, selected, ($('trust') as HTMLSelectElement).value, advisor)
})

$('task').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('ignite').click()
})

// ── tabs ──
const showView = (id: 'chat' | 'agent'): void => {
  ;($('chatview') as HTMLElement).classList.toggle('hidden', id !== 'chat')
  ;($('agentview') as HTMLElement).classList.toggle('hidden', id !== 'agent')
  ;($('tab-chat') as HTMLElement).classList.toggle('active', id === 'chat')
  ;($('tab-agent') as HTMLElement).classList.toggle('active', id === 'agent')
}
$('tab-chat').addEventListener('click', () => showView('chat'))
$('tab-agent').addEventListener('click', () => showView('agent'))

// ── chat ──
const chatLog = $('chatlog')
const chatHistory: { role: 'user' | 'assistant'; content: string }[] = []
let chatBusy = false

const chatLine = (cls: string, text: string): HTMLDivElement => {
  const div = document.createElement('div')
  div.className = cls
  div.textContent = text
  chatLog.appendChild(div)
  chatLog.scrollTop = chatLog.scrollHeight
  return div
}

let streamTarget: HTMLDivElement | null = null
let streamText = ''
api.onChatDelta((d) => {
  if (!streamTarget) return
  streamText += d
  streamTarget.textContent = streamText
  chatLog.scrollTop = chatLog.scrollHeight
})
api.onChatStatus((line) => chatLine('chat-status', `⚙ ${line}`))

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
  if (!chatLog.querySelector('.msg-user')) chatLog.innerHTML = ''
  chatLine('msg-user', `> ${q}`)
  chatHistory.push({ role: 'user', content: q })
  streamTarget = chatLine('msg-ai', '')
  streamText = ''
  chatBusy = true
  ;($('send') as HTMLElement).textContent = '···'
  void api
    .autoSend({
      history: [...chatHistory],
      brain: currentBrain(),
      trust: ($('trust') as HTMLSelectElement).value,
      auto: ($('auto') as HTMLInputElement).checked
    })
    .then((r) => {
      chatBusy = false
      ;($('send') as HTMLElement).textContent = 'SEND'
      if (r.error) {
        streamTarget!.textContent = `✗ ${r.error}`
        return
      }
      if (!streamText && r.answer) streamTarget!.textContent = r.kind === 'agent' ? `⚙ ${r.ok ? 'session complete' : 'no verified final'}\n\n${r.answer}` : r.answer
      if (r.sources.length) chatLine('chat-status', r.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n'))
      chatHistory.push({ role: 'assistant', content: r.answer })
      streamTarget = null
    })
}
$('send').addEventListener('click', sendChat)
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat()
})
