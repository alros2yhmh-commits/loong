# LOONG — UI Progress

**Updated:** 24 October 2026, 23:15
**Commit:** see `git log` — phase 0 and phases 1–4 are committed.

---

## Completed

### Phase 0 — the backend gaps (committed)
| # | Gap | What shipped |
|---|---|---|
| G1 | settings had no home | `server/settings.ts` + `GET/PUT /api/settings`. Atomic write, corrupt file moved aside, read-only dir cannot crash the agent. Merge-on-write, every field coerced and clamped. Permission mode remembered per folder except Plan. |
| G3 | nothing published the tool set | `GET /api/tools` — 20 tools with their access level |
| G5 | a restored session was blank | `GET /api/sessions/:id/state` — block count, live or not, plan progress. A `liveThreads` set is added when a stream opens and removed when it closes. |

Four new tests drive the real server over HTTP on a scratch port with its own
data dir. **168/168 green, `tsc -p tsconfig.server.json` clean.**

### Tooling research (committed)
`docs/ui-tooling-research.md`. **Two skills, zero MCPs, zero new runtime
dependencies.** The decisive fact came from the repository: `package.json` and
`node_modules` survived intact, so React 19, motion 14, react-markdown, hono,
node-pty and playwright-core were already present.

### Phases 1–4 — the interface (committed)
| File | What it is |
|---|---|
| `src/styles/tokens.css` | pure monochrome, the measured ink ladder, five hairline alphas, the four-region geometry, the asymmetric motion tokens |
| `src/styles/global.css` | the type ladder `.t-h1` … `.t-code`, `.ctl`, focus rings, scrollbars, markdown, reduced-motion |
| `src/lib/api.ts` | one HTTP client, every endpoint the interface consumes, `API_BASE` absolute under `file:` |
| `src/lib/blocks.ts` | events → blocks; the only place tokens fold into messages |
| `src/lib/stream.ts` | the SSE reader; one timer in flight |
| `src/components/Sidebar.tsx` | 280px, drags 240–400, project groups, session rows with state dots, memory + settings footer |
| `src/components/Composer.tsx` | 720px, radius 16, the 48px band, **the row under the prompt box** |
| `src/components/Transcript.tsx` | reader bubble, agent page, tool rows, thinking, plan, approval, question, audit, checks, screenshot, notice, subagent, failure |
| `src/components/StatusBar.tsx` | 36px, the live dot, mode, plan, the model that RAN, tokens, folder |
| `src/components/SettingsPanel.tsx` | a rail and one pane at a time |
| `src/App.tsx` | the shell; settings from the server, not localStorage |
| `electron/main.cjs` + `preload.cjs` | the window, the agent sidecar, the folder picker |

---

## Verified — the numbers

Driven by `scripts/audit-ui.mjs`, which launches the **packaged EXE** over CDP
and measures the real DOM:

| Surface | Contrast < AA | Unnamed controls | Text < 10px | Page overflow | Console errors |
|---|---|---|---|---|---|
| home | 0 | 0 | 0 | 0 | 0 |
| settings | 0 | 0 | 0 | 0 | 0 |
| narrow (900×620) | 0 | 0 | 0 | 0 | 0 |

And by `scripts/run-live.mjs`, which sends a real message through the composer:
the agent's stream reached the interface, blocks restored from disk rendered —
including `loong.checks` rows ("Checks: npm test passed."), notice rows, and the
skills list. The status bar read `idle · ask · plan 8/8 · qwen3:8b`.

**168/168 · `tsc --noEmit` clean · `npm run build` clean · packaged and driven.**

---

## Known defects, in the order they will be fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | **A live reply did not render inside the 90s window.** The stream arrived (`RUN_STARTED`, `loong.retry`, `loong.stop`), and blocks restored correctly afterwards — but `qwen3:8b` was busy loading and the reply landed after the probe's patience. Not yet proven end-to-end in one pass. | run-live.mjs | re-run with a warm model, or use `ask` mode with a longer window |
| 2 | **The packaged agent's workspace defaults to its own cwd** (`resources/agent`) when no folder is set, so a fresh install works in the wrong place. | `electron/main.cjs` | pass `LOONG_WORKSPACE` or set it on first run |
| 3 | **A session's `workspace` can be a bare word** ("agent"), which shows as a project name. Test data leaked into the real store. | sidebar grouping | a workspace that is not a path groups under "no folder" |
| 4 | **`+` (attach) is inert.** No file picker is wired. | Composer | either wire it or hide it — a control that does nothing is worse than no control |
| 5 | **Memory opens a toast.** The Memory panel was not rebuilt in this pass. | App | rebuild `MemoryPanel` against `GET/DELETE /api/memory` |
| 6 | **No diff pane.** `/api/git/diff` exists and the Changes button only reports a count. | App | build the diff viewer |
| 7 | **No command palette.** `Ctrl+K` focuses the sidebar filter instead of a palette over sessions, projects and files. | App | build the palette |
| 8 | **View mode is a single chip** that cycles; the reference has a labelled three-way control and `Ctrl+O`. | App | a proper segmented control |
| 9 | **No suggested prompts** after a reply. | Composer | gray text, `Tab` to accept |
| 10 | **No notification** when a run finishes unfocused. | electron/main.cjs | `new Notification` on the run's end |

---

## Next action

**Defect 2, then defect 1.** The workspace default is a correctness bug — a fresh
install works in the wrong folder — and it is a two-line fix in the shell. Then
re-run `scripts/run-live.mjs` with a warm model to close the one claim that is
not yet proven: a reply rendering inside the same pass that sent it.

After that, phases 5–8 in the plan's order: the diff pane (5), the session rail
and the remaining panes (6), memory and the palette (7), view modes,
suggestions and notifications (8).
