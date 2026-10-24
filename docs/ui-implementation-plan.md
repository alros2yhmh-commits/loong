# LOONG — UI Implementation Plan

**Status:** proposed. Ordered so that each phase ends with something that runs
and can be verified. Nothing here starts until the design spec is reviewed.

**Governing constraint:** the backend is finished and must not change, except
for gap **G1** (settings), which is a blocker and is therefore phase 0.

---

## Phase 0 — Unblock the backend (required before any UI)

| # | Task | Detail |
|---|---|---|
| 0.1 | `GET /api/settings` | returns the persisted preferences with defaults |
| 0.2 | `PUT /api/settings` | merges and persists; validates every field |
| 0.3 | Persist in `server/db.ts` | follow the existing store pattern; atomic write, corrupt file moved aside |
| 0.4 | Move `trust` and `mode` into settings | **keyed by folder**, matching the reference's per-folder memory |
| 0.5 | `GET /api/tools` | export the 19 tool names and their descriptions from `server/tools.ts` |
| 0.6 | Document the auth token's source | how the UI obtains `x-loong-token` now that the Electron bridge is gone |
| 0.7 | `GET /api/sessions/:id/state` | what a restored session is doing, so a reload is not a blank screen |
| 0.8 | Tests for all of the above | the suite is at 164/164 and must not regress |

**Exit:** `164 + new tests` green, `tsc -p tsconfig.server.json` clean, and a
`curl` of every new route shown in the report.

---

## Phase 1 — The shell and the tokens

| # | Task | Detail |
|---|---|---|
| 1.1 | Restore the app skeleton | Vite + React + TypeScript, `base: './'` |
| 1.2 | `src/styles/tokens.css` | exactly the tokens in the design spec — monochrome, the measured ink ladder, the five hairline alphas, the geometry, the durations, the easings |
| 1.3 | `src/styles/global.css` | the type ladder `.t-h1` … `.t-code`, `::selection` = `--selection`, scrollbars |
| 1.4 | The four regions | title bar 40 · sidebar 280 · main · status bar 36, as a fixed flex column |
| 1.5 | `MotionConfig` | `reducedMotion="user"`, wrapping the whole tree once |
| 1.6 | **`scripts/contrast.mjs`** | the WCAG probe, restored and wired into `npm test`. **Zero failures is the gate.** |
| 1.7 | **`scripts/audit-ui.mjs`** | the screen probe: page overflow, unnamed controls, text under 10px. **Zero is the gate.** |

**Exit:** a white window with four empty regions, both probes green.

## Phase 2 — The sidebar and sessions

| # | Task |
|---|---|
| 2.1 | `WORKSPACE` head, **Home**, **Projects** label with `+` and search |
| 2.2 | Project rows with `−`/`+` fold, session count, active state |
| 2.3 | Session rows: title, relative time, 6px state dot |
| 2.4 | The 4px resize grip, 240–400, persisted, double-click resets |
| 2.5 | Footer: **Memory**, **Settings** |
| 2.6 | Empty state with a **New thread** button |
| 2.7 | `Cmd/Ctrl+K` palette over sessions, projects and files |
| 2.8 | Rename inline; delete behind a confirm; **fork** into split view |

**Exit:** create, rename, delete, fork and switch sessions, all persisted.

## Phase 3 — The run

| # | Task |
|---|---|
| 3.1 | The composer: 720px, radius 16, the 48px control band, auto-grow |
| 3.2 | **The row under the prompt box**: folder · mode · trust · model |
| 3.3 | The model picker as a searchable 300px dropdown |
| 3.4 | `POST /api/agent` over a hand-rolled SSE reader (EventSource cannot POST) |
| 3.5 | The run bar: goal, `ctx %`, tokens, cost |
| 3.6 | Send → Stop cross-fade, the button never moves |
| 3.7 | **Steer without stopping**: a queued correction applies after the current action |
| 3.8 | The status bar, wired to the live stream |

**Exit:** a real run streams text, a tool call appears, `Esc` stops it, and a
queued message lands after the action completes.

## Phase 4 — The transcript

| # | Task |
|---|---|
| 4.1 | The reader's message: right-aligned, 70%, one sharp corner |
| 4.2 | The agent's message: the page, with the `Loong` / `Loong · working` eyebrow |
| 4.3 | Markdown with `dir="auto"`, code blocks, and clamping with a **Read more** |
| 4.4 | Tool rows: icon, name, one-line summary, duration; expand in place |
| 4.5 | Tool groups fold into one row with a count |
| 4.6 | **No chevrons, no arrows** — hover is the affordance |
| 4.7 | Thinking rows, folded into one summary row |
| 4.8 | The plan block with per-step state markers |
| 4.9 | The audit, checks, screenshot, subagent, notice, retry rows |
| 4.10 | Failure: one line, the reason, **Retry** |

**Exit:** a full run replays from `/api/threads/:id/blocks` with every block
rendering.

## Phase 5 — Approvals, questions and the diff

| # | Task |
|---|---|
| 5.1 | The approval card: tool, title, detail, **the diff**, Approve / Decline |
| 5.2 | The question card: question, options, free text |
| 5.3 | The diff viewer: side-by-side, per-line comments, `Cmd/Ctrl+Enter` to submit all |
| 5.4 | The `+N −N` indicator in the Changes card opening the diff pane |
| 5.5 | **Rewind behind an explicit diff** — never a blind button |

**Exit:** a run in `ask` trust parks on a write, shows the diff, and the
decision is recorded in the transcript.

## Phase 6 — The session rail and panes

| # | Task |
|---|---|
| 6.1 | Environment / Changes / Running / Context cards |
| 6.2 | The file tree pane and the file editor (auto-save by default) |
| 6.3 | The terminal pane over `node-pty` |
| 6.4 | The browser pane with `loong.screenshot` and auto-verify |
| 6.5 | Drag a pane by its header; resize by its edge; pop out and dock |
| 6.6 | The narrow-window overflow into **⋮** |

**Exit:** the four panes arrange themselves and survive a reload.

## Phase 7 — Memory, Skills, Library, Timers, Git, Traces, Settings

| # | Task |
|---|---|
| 7.1 | **Memory as its own screen** — search, grouped by project, forget per fact |
| 7.2 | Skills, Library, Integrations, MCP, Timers, Git, Traces panes |
| 7.3 | **Settings as a rail + one pane at a time**, grouped by the reader's model |
| 7.4 | Settings reads and writes `GET/PUT /api/settings` |

**Exit:** every backend surface in `ui-backend-mapping.md` has a screen.

## Phase 8 — View modes, shortcuts, polish

| # | Task |
|---|---|
| 8.1 | Normal / Thinking / Verbose, `Ctrl+O`, per-session, persisted |
| 8.2 | The full shortcut sheet, `Cmd/Ctrl+/` |
| 8.3 | Suggested prompts as gray text, `Tab` to accept |
| 8.4 | An OS notification when a run finishes unfocused |
| 8.5 | Empty, loading, error and offline states everywhere |
| 8.6 | Narrow and short window passes |

**Exit:** the reference's documented interaction set is complete.

---

## Recommended libraries

Inspected against the existing `package.json` before recommending:

| Need | Choice | Why |
|---|---|---|
| UI runtime | **React + TypeScript + Vite** | already the stack; `base: './'` for the packaged `file://` load |
| Animation | **Framer Motion** (`motion/react`) | already a dependency; `MotionConfig` handles reduced motion |
| Markdown | **react-markdown + remark-gfm** | the transcript is mostly markdown |
| Syntax highlighting | **Shiki** | accurate, themeable, and it can be made monochrome |
| Terminal | **node-pty + xterm.js** | the backend already has a pty bridge |
| Icons | **LOONG's own drawn set** | a generic set reads generic; 1.5px stroke, 16/12/20 |
| Fonts | **Inter + Inter Display**, self-hosted | two cuts of one family, no network fetch |
| State | **plain React + context** | the app is one stream and one tree; a store would be ceremony |
| Testing | **node:test + tsx** for logic, **Playwright-core** over CDP for the UI | both already used |

**Do not add:** a component library (MUI, Chakra, shadcn). The design is
deliberately not generic, and a component library's opinions would have to be
fought in every file.

## Verification gates — every phase, no exceptions

1. `tsc --noEmit` and `tsc -p tsconfig.server.json` clean.
2. `npm test` green.
3. `scripts/contrast.mjs` — **zero** elements below AA on every surface.
4. `scripts/audit-ui.mjs` — **zero** page overflow at 1280 / 900 / 480, **zero**
   unnamed controls, **zero** text under 10px, and real screenshots inspected.
5. The packaged app launched with `env -u ELECTRON_RUN_AS_NODE` and driven over
   CDP: a real run started, a tool call seen, an approval decided, a session
   restored.

A green build is not evidence. A screenshot is not evidence. **A driven run is
evidence.**

## Order of work

`Phase 0` (unblock) → `1` (shell) → `2` (sidebar) → `3` (run) → `4`
(transcript) → `5` (approvals) → `6` (panes) → `7` (memory/settings) → `8`
(polish).

Phases 0–5 are the product. 6–8 are the reference's full surface. If time runs
out, stop after 5 and ship: a run that streams, parks, shows a diff and records
the decision is the whole promise.
