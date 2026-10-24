# LOONG — Backend → UI Mapping

**Status:** derived by reading the actual route definitions, request bodies and
event payloads in `server/`. No capability below is inferred or invented; every
row was verified against the source.

Verified against: `server/index.ts` (routes), `server/agent.ts` (event
payloads), `server/tools.ts` (the tool set).

---

## 1. The run — `POST /api/agent`

**Request body** (`interface RunBody`, `server/index.ts:642`):

| Field | Type | Notes |
|---|---|---|
| `threadId` | string | falls back to `sessionId`, then a fresh uuid |
| `sessionId` | string | the conversation's id |
| `messages` | `ChatMessage[]` | filtered: non-empty string `content` only. **Empty → 400 `No messages to send.`** |
| `history` | `HistoryTurn[]` | **preferred over `messages`** — the conversation with tool calls and results. Server slices to the last 400 |
| `config` | `ProviderConfig` | **missing `model` → 400 `No model selected. Open Settings and pick one.`** |
| `mode` | `'agent' \| 'plan' \| 'ask'` | anything else becomes `'agent'` |
| `trust` | `'ask' \| 'auto'` | anything but `'auto'` becomes `'ask'` |
| `confidence` | `{ threshold?, decisionModel? }` | **honoured only when `trust === 'auto'`**; threshold clamped 0–1, a bad shape is dropped |
| `userName` | string | sliced to 40 chars — what the reader wants to be called |
| `capabilities` | `Partial<Capabilities>` | per-run capabilities |

**Rate limit:** more than a minute's worth of runs → **429** with a message.

**Response:** `text/event-stream` via `streamSSE` + `EventEncoder`. Events are
buffered and flushed as they are produced; `stream.onAbort` aborts the run. The
run id rides the async context so two concurrent runs cannot attribute each
other's writes.

### The events

| Event | Payload | UI component |
|---|---|---|
| `TEXT_MESSAGE_CONTENT` | `{ delta: string }` | the agent message block, appended per delta |
| `TOOL_CALL_START` | AG-UI standard | a tool activity row |
| `TOOL_CALL_RESULT` | AG-UI standard | the row's result |
| `STEP_STARTED` | AG-UI standard | the step count in the run bar |
| `RUN_ERROR` | AG-UI standard | the failure line + Retry |
| `loong.approval_requested` | `{ id, tool, wire, title, detail, files? }` | **the approval card.** `wire` is the raw tool name so an MCP tool shows as `mcp__server__tool`; `files` is `payload.diff` when present |
| `loong.approval_resolved` | approval resolved | the card's resolved state |
| `loong.question` | `{ id, question, detail, options }` | **the question card** |
| `loong.plan` | the `Plan` object | **the plan block** and the run bar's `plan n/n` |
| `loong.audit` | the `Audit` object | the audit card |
| `loong.checks` | `{ ok, label }` and `{ text }` | the verification rows |
| `loong.screenshot` | `{ path, tool }` | a thumbnail; the image is served by `GET /api/shots/:name` |
| `loong.subagent` | `{ phase, scope, task, detail }` | the subagent row |
| `loong.notice` | `{ text }` | an inline notice line |
| `loong.retry` | an object | the retry row |
| `loong.stop` | an object | the stopped state |
| `loong.run_failed` | `{ cause, detail, model }` | the failure line, with the friendly reason |
| `loong.tool_duration` | `{ id, tool, ms }` | the row's duration |
| `loong.trust` | `{ trust }` | the trust chip |

**Plan mode is enforced server-side:** the read-only tool set is
`list_dir, read_file, grep, fetch_url, web_search, recall` plus the repository
reads. A UI that shows a write button in plan mode is lying.

**Security gate:** after a real run, `securityScan: true` produces a
`loong.notice` with `Security gate: N finding(s) — critical, do not ship`. The
UI must render it verbatim and must never soften it.

**Step budget:** at the step limit the server emits a notice telling the reader
to send "continue" or split the task. The UI should offer a **Continue** button
that sends exactly that word.

---

## 2. Sessions and threads

| Route | Method | Body / params | UI |
|---|---|---|---|
| `/api/sessions` | GET | — | the sidebar list |
| `/api/sessions` | POST | — | **New thread** |
| `/api/sessions/:id` | DELETE | — | delete, behind a confirm |
| `/api/sessions/:id` | PATCH | `{ title }` (≤120 chars) | rename |
| `/api/sessions/:id/fork` | POST | — | **split view / fork a session** |
| `/api/threads/:id/blocks` | GET | — | restore a transcript |
| `/api/threads/:id/blocks` | PUT | `{ blocks: Block[] }` (max 5000) | persist the transcript |
| `/api/sessions/:id/messages` | GET | — | the raw message log |

**Blocks are the source of truth for the transcript.** `PUT` caps at 5000
blocks; the UI must clamp before sending, not after.

---

## 3. Workspace

| Route | Method | Body | UI |
|---|---|---|---|
| `/api/workspace` | GET | — | the folder control in the row under the prompt |
| `/api/workspace` | POST | `{ workspace }` | change the folder — **this is what makes a project** |

The folder *is* the project. There is no separate project entity, and the UI
must not invent one.

---

## 4. Approvals and questions

| Route | Method | Body | UI |
|---|---|---|---|
| `/api/approvals` | GET | — | the pending approvals list |
| `/api/approvals/:id` | POST | `{ approved: boolean }` | Approve / Decline |
| `/api/questions` | GET | — | the pending questions list |
| `/api/questions/:id` | POST | `{ answer: string \| null }` | submit, or skip with `null` |

Both are **parked state**: the run is suspended until the reader answers. The
UI must show *why* it is waiting, not just that it is.

---

## 5. Models and providers

| Route | Method | UI |
|---|---|---|
| `/api/providers` | GET | the provider picker |
| `/api/models` | GET | the models for the current provider |
| `/api/catalog/models` | GET | the full catalogue (322 models) |
| `/api/openrouter/models` | GET | the remote catalogue, with `vision` and `context` |

The model picker needs a search box: a 322-row dropdown is not a picker.

---

## 6. Files, shots and git

| Route | Method | UI |
|---|---|---|
| `/api/tree` | GET | the project tree pane |
| `/api/files` | GET | a file's contents (the file editor) |
| `/api/shots/:name` | GET | a screenshot's bytes |
| `/api/git/status` | GET | the Changes card |
| `/api/git/diff` | GET | **the diff pane**, and the `+N −N` indicator |
| `/api/git/log` | GET | the history list |

The diff viewer is the reference's centrepiece and LOONG has the endpoint for
it. It was never built.

---

## 7. Memory, skills, library, integrations, MCP

| Route | Methods | UI |
|---|---|---|
| `/api/memory`, `/api/memory/:id` | GET, DELETE | the Memory panel — its own screen, not a Settings section |
| `/api/skills`, `/api/skills/:name` | GET | the Skills pane |
| `/api/library`, `/api/library/:id` | GET | the Library pane |
| `/api/integrations/:id` | GET, POST, DELETE | the Integrations pane |
| `/api/mcp`, `/api/mcp/config`, `/api/mcp`, `/api/mcp/:name/test`, `/api/mcp/:name` | GET, PUT, POST, DELETE | the MCP pane |

---

## 8. Timers, checkpoints, traces, health

| Route | Methods | UI |
|---|---|---|
| `/api/timers`, `/api/timers/:id`, `/api/timers/:id/ack` | GET, POST, DELETE, POST | the Timers pane |
| `/api/checkpoints`, `/api/checkpoints/rewind` | GET, POST | the rewind action — **behind an explicit diff, never a blind button** |
| `/api/traces`, `/api/traces/:runId` | GET | the trace viewer — the evidence for "did it work" |
| `/api/health` | GET | the status bar's source of truth |

---

## 9. The 19 agent tools

`server/tools.ts` exports: `listDir`, `readFileTool`, `grepTool`,
`writeFileTool`, `editFileTool`, `multiEditTool`, `mkdirTool`,
`deleteFileTool`, `moveFileTool`, `shellTool`, `fetchTool`, `webSearchTool`
(providers: brave, duckduckgo, searxng, tavily), `createAskUserTool`,
`createPlanTool`, `createAuditTool`, `createProposeChangesTool`,
`libraryDocsTool`, `thinkingTool`, `readDocumentTool`, `browserTool`.

| Tool | UI treatment |
|---|---|
| `list_dir`, `read_file`, `grep` | a collapsed row; expandable to the result |
| `write_file`, `edit_file`, `multi_edit`, `mkdir`, `delete_file`, `move_file` | **always an approval card with the diff** in `ask` trust |
| `shell` | an approval card showing the command and its cwd |
| `fetch_url`, `web_search` | a row with the URL or the query |
| `ask_user` | the question card |
| `plan` | the plan block |
| `audit` | the audit card |
| `propose_changes` | the approval card, with every file in the diff |
| `library_docs` | a row with the topic |
| `thinking` | the thinking rows |
| `read_document` | a row with the document |
| `browser` | a row; `loong.screenshot` shows the result |

---

## 10. Backend gaps that genuinely block implementation

| # | Gap | Impact | Fix |
|---|---|---|---|
| **G1** | **No settings endpoint.** Every preference lived in the browser's `localStorage`, which was deleted with the interface. | Nothing persists. A reader re-picks their model every launch. | `GET /api/settings` + `PUT /api/settings`, persisted in `server/db.ts` |
| **G2** | **`trust` and `mode` are per-request only.** The reference remembers the permission mode **per folder**. | The reader re-chooses trust every run. | fold into G1, keyed by folder |
| **G3** | **No `GET /api/tools`.** | The UI must hardcode the 19 tool names, and it will drift. | export the tool list from `server/tools.ts` |
| **G4** | **Auth is a single shared token** (`x-loong-token`), and the Electron bridge that supplied it was deleted. | The UI has no way to obtain the token. | read it from an env var or a well-known local file, documented |
| **G5** | **No session-level "what is running" endpoint.** The running state only exists inside the SSE stream. | A restored session shows nothing until the next run. | `GET /api/sessions/:id/state` |
| **G6** | **No notification channel.** | A run that finishes while the window is unfocused is invisible. | OS notification from the shell, driven by the run's end |

**G1 is a hard blocker.** Without it there is no product, only a demo.

---

## 11. Invariants the UI must never break

1. **Never imply an approval that did not happen.** An approval card is pending
   until `loong.approval_resolved` or a `POST /api/approvals/:id` response says
   otherwise.
2. **Never imply a file changed.** The Changes card reads `/api/git/diff`; it
   does not infer from tool calls.
3. **Never imply a check passed.** `loong.checks` carries `{ ok, label }`. Show
   the label and the boolean, not a green tick of your own invention.
4. **Never hide a security finding.** `Security gate: N finding(s) — critical,
   do not ship` is rendered verbatim.
5. **Plan mode is read-only**, server-enforced. The UI must not offer a write.
6. **A resolved approval stays in the transcript.** It is the record that the
   reader decided.
