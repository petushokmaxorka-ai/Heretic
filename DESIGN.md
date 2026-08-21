# HERETIC — Design Doctrine

> Heretic is the product. Anathemetron is the organism that lives inside it.
> The face is a ledger, not a chat. Every step the agent takes is a line with a verdict.

## Lineage (v2 — Antigravity reference, 2026-08-18)

- Reference: Google Antigravity — light, clean surfaces, rounded geometry (14-16px cards, pill controls), soft shadows, sans typography (Inter), sidebar navigation, message bubbles, status pills
- Identity kept: crimson accent (sparingly), verdict colors (ok/warn/bad + soft tints), ◆ glyphs, "ANATHEMETRON" persona
- Mono only for step details and urls — the chrome speaks sans
- NEW DEFAULT (2026-08-18, Principal's order): "Mechanicus" — the dashboard lineage skin
  (gold #c8a84b + crimson on void-black, faint scanlines, gold avatar/send button) over the
  Antigravity bones. Antigravity = UX patterns (bubbles, composer, chips, cards);
  Mechanicus = оформление. Theme cycle: mechanicus → light → dark.
- DIALOGUS transplant: markdown (zero-dep CSP-safe renderer), sessions
  (localStorage, restore/switch/new), streaming — its soul on our engine, not its file.

## Core visual idea — Step Ledger

The primary surface is a ledger of agent steps:

```
⚙ 1  fs.write  sandbox/notes.txt          (+3 lines)
✓    verified  path-safety ✓ allowlist ✓
⚠ 2  shell     rm -rf sandbox/tmp         → awaiting approval (HITL)
✗ 3  fs.write  ../escape.txt             → REJECTED, rolled back
```

Glyphs: `⚙` step · `✓` verified · `⚠` needs approval · `✗` rejected/rolled back · `◆` session · `✗`/`◉` dead/alive organism status.

Verification is the product's differentiator, so verification is what the UI shows first.

## Tokens (default theme "Light" · dark = legacy Void)

| Token | Value | Meaning |
|---|---|---|
| `--bg` | `#050505` | void black |
| `--ink` | `#E8E3D8` | parchment text |
| `--dim` | `#8A8578` | secondary text |
| `--accent` | `#C8102E` | arterial crimson (actions, session) |
| `--verify` | `#00BFBF` | teal — verification states |
| `--warn` | `#C8A84B` | gold — reserved for warnings (not chrome) |
| `--edge` | `#2A2A2A` | hairlines |

Font: monospace family (JetBrains Mono / IBM Plex Mono / system mono). No sans in the ledger.

## Optional theme "Dark Mechanicus"

Gold chrome, scanlines, red flicker bands (the `dm.css` pattern). Ships OFF by default:
the taste of the faithful is a preference, not an onboarding wall.

## Surfaces

1. **CLI (v0.1, now)** — ANSI crimson + glyphs; the ledger printed live. The first face of the product.
2. **Desktop shell (Phase 2+)** — panes: Ledger / Chat / Diff / Terminal / Browser; tray pulse (`◉` alive).
3. **Trust bar** — always visible: `MODE: manual ◆ edits ◆ auto` + resident brain indicator.

## Laws

- The shell contains zero brain. Kill the window — the engine lives. Kill the engine — the window says so honestly.
- Every write the agent makes is shown as a diff before it lands (manual/edits modes).
- Local brain is the default resident; clouds are escalation, never the home.
