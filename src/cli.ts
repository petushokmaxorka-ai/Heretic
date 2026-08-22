#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// HERETIC — CLI (the first face of the product)
// Ledger in the terminal: crimson session, teal verdicts, gold warnings.
// ═══════════════════════════════════════════════════════════

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { runAgent } from './engine/agent.js'
import { runCouncil } from './engine/council.js'
import { autoAllow, denyAll } from './engine/policy.js'
import { skullGuardAll } from './engine/skull.js'
import { EchoBrain } from './brains/echo.js'
import { OpenAIBrain } from './brains/openai.js'
import { discoverLocal } from './discovery.js'
import { fsTools } from './tools/fs.js'
import { shellTool } from './tools/shell.js'
import { vaultTools } from './tools/vault.js'
import { Sandbox } from './tools/sandbox.js'
import { runChat } from './engine/chat.js'
import { observe } from './engine/observe.js'
import { webSearchTool } from './tools/search.js'
import { codeSearch } from './tools/code.js'
import { fetchTool } from './tools/fetch.js'
import { planTools } from './tools/plan.js'
import { llamaStatusTool, getResidents, pickResident } from './tools/llama.js'
import { memoriaQuery, servicesHealth } from './tools/organs.js'
import { gitTools } from './tools/git.js'
import { sysInfo } from './tools/sys.js'
import { shellBgTools } from './tools/shell-bg.js'
import { netTools } from './tools/net.js'
import { procTextTools } from './tools/proc-text.js'
import { cryptoExtraTools } from './tools/crypto-extra.js'
import { infoTools } from './tools/info.js'
import { organExtraTools } from './tools/organs-extra.js'
import { deepTools } from './tools/deep.js'
import { askUser, makeSubtaskTool } from './tools/agent-extra.js'
import { isThinkingLevel, type ThinkingLevel } from './thinking.js'
import type { ApprovalPolicy, Brain, Step } from './protocol/types.js'

const C = {
  crimson: '\x1b[31;1m',
  teal: '\x1b[36m',
  gold: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  off: '\x1b[0m'
}

function usage(): string {
  return [
    'heretic — local-first agentic engine',
    '',
    '  node out/src/cli.js "task text" [options]',
    '',
    'Options:',
    '  --brain <url|echo>   OpenAI-compatible base URL, "echo" for the test brain',
    '  --model <id>         model id (default: first resident found / "default")',
    '  --key <api-key>      bearer key for cloud brains',
    '  --root <dir>         sandbox root (default: tmp)',
    '  --max-steps <n>      step budget (default 12)',
    '  --yes                auto-approve mutating steps',
    '  --dry                deny all mutating steps (safe rehearsal)',
    '  --list-brains        scan localhost runtimes and exit',
    '  --advisor <url|echo> council mode: advisor debates, brain executes',
  '  chat                chat subcommand: node out/src/cli.js chat [question]',
  '    --web             enable web search in chat',
  '    --thinking <lvl>  low | mid | high | max (default mid)',
    '  --advisor-model <id> model id for the advisor brain',
    '  --advisor-key <key>  api key for a cloud advisor',
    '',
    'Routing: prefix the task with @brain-id to pick a brain: "@kimi review this"'
  ].join('\n')
}

function glyph(step: Step): { g: string; c: string } {
  if (step.verdict === 'verified') return { g: step.kind === 'final' ? '◆' : '✓', c: C.teal }
  if (step.verdict === 'awaiting') return { g: '⚠', c: C.gold }
  return { g: '✗', c: C.red }
}

function printStep(step: Step): void {
  const { g, c } = glyph(step)
  const head = `${c}${g}${C.off} ${C.dim}${step.index}${C.off} ${step.title}`
  const detail = step.detail ? ` ${C.dim}${step.detail.split('\n')[0]}${C.off}` : ''
  const note = step.note ? ` ${C.gold}[${step.note}]${C.off}` : ''
  console.log(head + detail + note)
}

async function interactivePolicy(): Promise<ApprovalPolicy> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    allow: async (action, detail) => {
      printStep({ index: 0, kind: 'tool', title: action, detail, verdict: 'awaiting' })
      const answer = await rl.question(`${C.gold}approve? [y/N]${C.off} `)
      return answer.trim().toLowerCase().startsWith('y')
    }
  }
}

async function main(): Promise<number> {
  const valueFlags = ['brain', 'model', 'key', 'root', 'max-steps', 'advisor', 'advisor-model', 'advisor-key', 'thinking']
  const argv = process.argv.slice(2)

  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (valueFlags.includes(name)) {
        flags[name] = argv[++i] ?? ''
      } else {
        flags[name] = true
      }
    } else {
      positionals.push(a)
    }
  }
  const flag = (name: string): string | undefined => (typeof flags[name] === 'string' ? (flags[name] as string) : undefined)
  const has = (name: string): boolean => flags[name] === true

  let chatMode = false
  if (positionals[0] === 'chat') {
    chatMode = true
    positionals.shift()
  }
  const task = positionals.join(' ')

  if (has('help') || (!task && !has('list-brains') && !chatMode)) {
    console.log(usage())
    return task ? 1 : 0
  }

  const root = flag('root') ?? join(tmpdir(), `heretic-sandbox-${process.getuid?.() ?? 0}`)
  mkdirSync(root, { recursive: true })

  if (has('list-brains')) {
    console.log(`${C.crimson}◆${C.off} scanning localhost runtimes...`)
    const hits = await discoverLocal()
    if (!hits.length) {
      console.log(`${C.red}✗${C.off} no local runtimes found (llama-swap :11436, ollama :11434, lmstudio :1234)`)
      return 1
    }
    for (const h of hits) {
      console.log(`${C.teal}✓${C.off} ${h.name} ${C.dim}${h.baseUrl}${C.off}`)
      for (const m of h.models) console.log(`    ${C.dim}- ${m}${C.off}`)
    }
    return 0
  }

  let brain: Brain
  const brainUrl = flag('brain')
  if (brainUrl === 'echo') {
    brain = new EchoBrain(['OK'])
  } else {
    let baseUrl = brainUrl
    let model = flag('model')
    if (!baseUrl) {
      const found = (await discoverLocal())[0]
      if (!found) {
        console.log(`${C.red}✗${C.off} no local runtime found — pass --brain <url> or --brain echo`)
        return 1
      }
      baseUrl = found.baseUrl
      if (!model) {
        const residents = await getResidents(baseUrl)
        const pick = pickResident(found.models, residents)
        model = pick.model
        const mark = pick.resident === true ? '◉ resident' : '? residency unknown'
        console.log(`${C.teal}✓${C.off} brain: ${found.name} ${C.dim}${model} · ${mark}${C.off}`)
        if (pick.resident !== true) {
          console.log(`${C.gold}⚠${C.off} ${C.dim}resident unknown — a non-resident request will swap the GPU${C.off}`)
        }
      } else {
        console.log(`${C.teal}✓${C.off} brain: ${found.name} ${C.dim}${model}${C.off}`)
      }
    }
    brain = new OpenAIBrain('local', baseUrl, baseUrl, model ?? 'default', flag('key'))
  }

  const policy = has('dry') ? denyAll : has('yes') || chatMode ? autoAllow : await interactivePolicy()
  const tools = skullGuardAll([
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
  ...gitTools,
  sysInfo,
  ...shellBgTools,
  ...netTools,
  ...procTextTools,
  ...cryptoExtraTools,
  ...infoTools,
  ...organExtraTools,
  ...deepTools,
  askUser
])

  if (chatMode) {
    let web = has('web')
    let auto = true
    let thinking: ThinkingLevel = isThinkingLevel(flag('thinking') ?? '') ? (flag('thinking') as ThinkingLevel) : 'mid'
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const history: { role: 'user' | 'assistant'; content: string }[] = []

    const ask = async (question: string, webEff = web, thinkingEff = thinking): Promise<void> => {
      history.push({ role: 'user', content: question })
      process.stdout.write(`${C.teal}◆${C.off} `)
      const { answer } = await runChat({
        history,
        brain,
        thinking: thinkingEff,
        web: webEff,
        onDelta: (d) => process.stdout.write(d),
        onStatus: (l) => console.log(`${C.dim}⚙ ${l}${C.off}`)
      })
      history.push({ role: 'assistant', content: answer })
      console.log(`\n${C.dim}[${brain.id} · ${thinkingEff}${webEff ? ' · web' : ''}]${C.off}\n`)
    }

    if (task) {
      if (auto) {
        const v = observe(task)
        console.log(`${C.dim}⚙ observe: ${v.mode}${v.web ? ' · web' : ''} · ${v.thinking} (${v.reasons.join(', ')})${C.off}`)
        if (v.mode === 'agent') {
          const r = await runAgent(task, { brain, tools: [...tools, makeSubtaskTool({ brain, tools, sandbox: new Sandbox(root), policy: autoAllow })], sandbox: new Sandbox(root), policy: autoAllow, maxSteps: 8, ask: async (question) => { console.log(`${C.gold}?${C.off} ${question}`); const rlAsk = createInterface({ input: process.stdin, output: process.stdout }); try { return await rlAsk.question('> ') } finally { rlAsk.close() } } })
          console.log(`\n${C.crimson}◆${C.off} ${r.final || '(no final answer)'}`)
          return r.ok ? 0 : 1
        }
        web = web || v.web
        if (isThinkingLevel(v.thinking)) thinking = v.thinking
      }
      await ask(task)
      return 0
    }
    console.log(`${C.crimson}◆ HERETIC CHAT${C.off} ${C.dim}/web /think low|mid|high|max /auto /exit — observe: on${C.off}`)
    for (;;) {
      const q = (await rl.question(`${C.crimson}>${C.off} `)).trim()
      if (!q) continue
      if (q === '/exit') return 0
      if (q === '/auto') { auto = !auto; console.log(`${C.dim}observe: ${auto ? 'on' : 'off'}${C.off}`); continue }
      if (q === '/web') { web = !web; console.log(`${C.dim}web: ${web ? 'on' : 'off'}${C.off}`); continue }
      if (q.startsWith('/think ')) {
        const lvl = q.slice(7).trim()
        if (isThinkingLevel(lvl)) { thinking = lvl; console.log(`${C.dim}thinking: ${lvl}${C.off}`) }
        else console.log(`${C.red}✗${C.off} low | mid | high | max`)
        continue
      }
      try {
        if (auto) {
          const v = observe(q)
          console.log(`${C.dim}⚙ observe: ${v.mode}${v.web ? ' · web' : ''} · ${v.thinking} (${v.reasons.join(', ')})${C.off}`)
          if (v.mode === 'agent') {
            history.push({ role: 'user', content: q })
            const r = await runAgent(q, { brain, tools: [...tools, makeSubtaskTool({ brain, tools, sandbox: new Sandbox(root), policy: autoAllow })], sandbox: new Sandbox(root), policy: autoAllow, maxSteps: 8, ask: async (question, options) => { const rlAsk = createInterface({ input: process.stdin, output: process.stdout }); try { if (options?.length) { console.log(`${C.gold}?${C.off} ${question} ${C.dim}[${options.join('/')} | свободный ответ]${C.off}`); } else console.log(`${C.gold}?${C.off} ${question}`); return await rlAsk.question('> ') } finally { rlAsk.close() } } })
            const final = r.final || '(no final answer)'
            history.push({ role: 'assistant', content: final })
            console.log(`${C.teal}◆${C.off} ${final}\n${C.dim}[${brain.id} · agent]${C.off}\n`)
            continue
          }
          await ask(q, web || v.web, isThinkingLevel(v.thinking) ? v.thinking : thinking)
          continue
        }
        await ask(q)
      } catch (e) { console.log(`${C.red}✗${C.off} ${(e as Error).message}`) }
    }
  }

  console.log(`${C.crimson}◆ HERETIC${C.off} ${C.dim}root=${root} · skull: active${C.off}`)

  const advisorUrl = flag('advisor')
  if (advisorUrl) {
    const advisor: Brain =
      advisorUrl === 'echo'
        ? new EchoBrain(['advisor: proceed carefully and keep it minimal'])
        : new OpenAIBrain('advisor', advisorUrl, advisorUrl, flag('advisor-model') ?? 'default', flag('advisor-key'))
    console.log(`${C.crimson}◆ COUNCIL${C.off} ${C.dim}advisor=${advisor.id}${C.off}`)
    const councilled = await runCouncil(task, {
      brain,
      advisors: [{ brain: advisor, role: 'advisor' }],
      tools,
      sandbox: new Sandbox(root),
      policy,
      maxSteps: Number(flag('max-steps') ?? 12) || 12,
      onStep: printStep
    })
    return councilled.ok ? (console.log(`\n${C.crimson}◆${C.off} ${councilled.final}`), 0) : (console.log(`\n${C.red}✗${C.off} no verified final answer`), 1)
  }

  const result = await runAgent(task, {
    brain,
    tools,
    sandbox: new Sandbox(root),
    policy,
    maxSteps: Number(flag('max-steps') ?? 12) || 12,
    onStep: printStep
  })

  if (result.ok) {
    console.log(`\n${C.crimson}◆${C.off} ${result.final}`)
    return 0
  }
  console.log(`\n${C.red}✗${C.off} session ended without a verified final answer`)
  return 1
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
