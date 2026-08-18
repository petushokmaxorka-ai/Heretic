# HERETIC

Local-first agentic engine: **small local brain + strong verification + cloud escalation.**

Anathemetron — the organism — lives inside.
The face is a ledger, not a chat: every step the agent takes is a line with a verdict
(`⚙` step · `✓` verified · `⚠` approval · `✗` rejected/rolled back).

## Status

Phase 0–1 (engine core): agent loop, sandboxed tools, approval gate, brain connector,
local runtime discovery. CLI only — the desktop shell comes in Phase 2+ (see DESIGN.md).

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

# deterministic offline brain (no runtime needed, CI-friendly)
node out/src/cli.js "..." --brain echo
```

## Safety laws

1. **Guest protocol** — never spawns a model server if one exists (discovery-first).
2. **Sandbox** — all agent paths resolve inside the sandbox root; escapes are rejected and recorded.
3. **Allowlist** — shell tool runs a fixed set of binaries, `spawn` without shell, hard timeout.
4. **Approval gate** — mutating tools pass through an approval policy (`--yes` / `--dry` / interactive HITL).
5. **Step ledger** — every action lands in the ledger with a verdict; failures roll back, the loop survives.

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
```

*«Anathemetron — the organism — lives inside.
The face is a ledger, not a chat.»*
