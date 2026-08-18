// HERETIC renderer — the ledger face. Vanilla TS, zero frameworks.

interface StepView {
  index: number
  kind: string
  title: string
  detail: string
  verdict: string
  note?: string
}

interface HereticApi {
  runSession(task: string, brain: { kind: 'echo' | 'openai'; url?: string; model?: string; key?: string }, trust: string): Promise<{ ok: boolean; error?: string }>
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

  running = true
  $('ignite').textContent = 'RUNNING'
  ledger.innerHTML = ''
  line(`<div class="step dim">◆ session start · trust=${($('trust') as HTMLSelectElement).value}</div>`)
  void api.runSession(task, selected, ($('trust') as HTMLSelectElement).value)
})

$('task').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('ignite').click()
})
