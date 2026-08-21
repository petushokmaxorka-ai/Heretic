# ◆ HERETIC

**The flagship AI desktop that runs on YOUR brains.** Local models by default, cloud by key — chat, delegate, verify.

> Heretic is the product. Anathemetron is the organism that lives inside.

## Why another AI app

| Everyone else | Heretic |
|---|---|
| Cloud-only brain, your data leaves | **Local-first**: llama-swap / Ollama / LM Studio autodetected, offline forever |
| Chat OR agent, pick a tab | **Observe**: one input — the intent router decides chat/agent, web, thinking depth (verdicts shown, never silent) |
| Trust the model | **Verified agency**: every step lands in a ledger — path-safety → allowlist → diff review → approval; SKULL immune guard + audit trail |
| One model per session | **Council**: advisors debate, the local brain executes with the debate as context |
| Memory = chat history | **Vault**: append-only long-term memory, every recall is a visible ledger step |
| Generic | **Heretic-mode organs**: `llama.status` (◉ residents, swap-safe GET-only), `services.health`, semantic memory — your machine's organs as agent tools |

## Quick start

```bash
git clone https://github.com/petushokmaxorka-ai/Heretic && cd Heretic
npm install && npm test          # engine: 70+ hermetic tests, no GPU needed
cd desktop && npm install && npm run dev
```

## Downloads (latest)

| OS | File |
|----|------|
| Windows | [Heretic-Setup.exe](https://github.com/petushokmaxorka-ai/Heretic/releases/latest/download/Heretic-Setup.exe) (installer — auto-updates) |
| Windows | [Heretic-win-portable.zip](https://github.com/petushokmaxorka-ai/Heretic/releases/latest/download/Heretic-win-portable.zip) (portable — no auto-update) |
| Linux | [Heretic.AppImage](https://github.com/petushokmaxorka-ai/Heretic/releases/latest/download/Heretic.AppImage) (auto-updates) |
| Linux | [Heretic.tar.gz](https://github.com/petushokmaxorka-ai/Heretic/releases/latest/download/Heretic.tar.gz) (no auto-update) |

## Safety laws

1. **Guest protocol** — never spawns a model server if one exists; swaps are impossible from status code paths (GET-only, test-enforced)
2. **Sandbox** — paths resolve inside the root; escapes rejected and recorded
3. **Diff before write** — `edits`/`manual` trust modes show exactly what will change
4. **SKULL-lite** — destructive patterns blocked, per-session mutation cap, append-only audit
5. **Resident guard** — non-resident models warn before any GPU swap

## Faces

- **CLI** — `chat` REPL (observe auto-routing, `/web`, `/think low|mid|high|max`), one-shot agent, council
- **Desktop** — Mechanicus skin over modern bones: bubbles, ledger cards, approvals, tray pulse, STOP, streaming

## Status

Phase 0–4 shipped + CHAT PACK + OBSERVE: the surface picks itself. One input —
the intent observer (homage to the void-shield observatory) classifies each
request: chat or agent, needs web or not, thinking depth — with its reasons
printed into the log. Transparent routing, manual override everywhere.
SearXNG autodetect (:8888/:8080) rides the web path in Heretic-mode.

Phase 0–4 shipped + CHAT PACK: flagship chat surface — ask anything, streaming
answers (SSE), thinking levels low/mid/high/max (token budget + reasoning_effort
hint + prompt directive), keyless web search (DuckDuckGo lite; SearXNG for
Heretic-mode) with RAG-lite source injection; CLI `chat` subcommand (REPL +
one-shot, /web /think commands); desktop CHAT|AGENT tabs.

Phase 0–4 shipped: COUNCIL (advisors debate — synthesizer executes with the debate
as context), VAULT memory (remember/recall, append-only JSONL, transparent
ledger steps), SKULL-lite immune guard (destructive-pattern blacklist,
mutation cap, append-only audit trail) over every tool.

Phase 0–3 shipped: engine core + Electron shell (`desktop/`) with Step Ledger UI,
trust modes, tray pulse, close-to-tray, agent browser pane (WebContentsView with
screenshot verification), native notifications, electron-updater (GitHub Releases),
release pipeline (tag v* → AppImage + tar.gz + NSIS).

## Quick start

```bash
npm install
npm run build
npm test                      # hermetic: no GPU, no services

# scan localhost for brains (llama-swap :11436 / ollama :11434 / lmstudio :1234)
node out/src/cli.js --list-brains

# run an agent task against the first resident found (approval prompts on writes)
node out/src/cli.js "create notes/hello.txt with one line: hi" --yes

# rehearse safely: all mutating steps denied
node out/src/cli.js "..." --dry

# council: advisor debates, brain executes
node out/src/cli.js "..." --brain echo --advisor echo --yes

# deterministic offline brain (no runtime needed, CI-friendly)
node out/src/cli.js "..." --brain echo

# flagship chat: REPL with /web, /think low|mid|high|max, /exit
node out/src/cli.js chat --brain echo
node out/src/cli.js chat "one-shot question" --web --thinking high
```

## Safety laws

1. **Guest protocol** — never spawns a model server if one exists (discovery-first).
2. **Sandbox** — all agent paths resolve inside the sandbox root; escapes are rejected and recorded.
3. **Allowlist** — shell tool runs a fixed set of binaries, `spawn` without shell, hard timeout.
4. **Approval gate** — mutating tools pass through an approval policy (`--yes` / `--dry` / interactive HITL).
5. **Step ledger** — every action lands in the ledger with a verdict; failures roll back, the loop survives.
6. **SKULL-lite** — every mutating call passes an immune guard (pattern blacklist, per-session mutation cap) and lands in `skull-audit.jsonl`.
7. **Vault** — long-term memory is append-only and transparent: `memory.remember` / `memory.recall` are ordinary ledger steps.

## Tool protocol

Any OpenAI-compatible brain works — including small GGUF residents — because tool calls
travel as fenced JSON in plain text:

~~~
```tool
{"name":"fs.write","args":{"path":"notes/a.txt","content":"..."}}
```
~~~

## Architecture

```
CLI / desktop shell (zero brain)
        │
   agent loop  →  verification ladder (path → allowlist → approval)
        │
   tools: fs.read / fs.write / fs.list / shell   (sandboxed)
        │
   brains: llama-swap · ollama · lmstudio · cloud APIs (BYO key)
   eyes:   browser.open — pane + title + excerpt + screenshot (url-guard: http/https only)
```

*«Anathemetron — the organism — lives inside.
The face is a ledger, not a chat.»*
