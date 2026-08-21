# HERETIC

Local-first agentic engine: **small local brain + strong verification + cloud escalation.**

Anathemetron — the organism — lives inside.
The face is a ledger, not a chat: every step the agent takes is a line with a verdict
(`⚙` step · `✓` verified · `⚠` approval · `✗` rejected/rolled back).

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
