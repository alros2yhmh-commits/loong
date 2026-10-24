# LOONG — Reference Research: Claude Code Desktop

**Status:** research only. No code was written, no package installed, no file
deleted, no backend modified.
**Date:** 24 October 2026
**Method:** the three official Anthropic sources below, read in full. Nothing in
this document comes from a third-party clone, a blog, or memory of an older
screenshot.

## Sources

| # | Source | URL |
|---|---|---|
| S1 | Anthropic blog — "Redesigning Claude Code on desktop for parallel agents" (14 Apr 2026) | https://claude.com/blog/claude-code-desktop-redesign |
| S2 | Claude Code docs — "Use Claude Code Desktop" | https://code.claude.com/docs/en/desktop |
| S3 | Claude Code docs — "Get started with the desktop app" | https://code.claude.com/docs/en/desktop-quickstart |

**Important negative finding:** S2 contains a section that would be called "UI
measurements" in a design spec, and it holds **no pixel dimensions at all**.
Every number in it is a version gate, a timeout, a count, or a port. So *no
font size, sidebar width, padding, radius, or animation duration in this
document can be attributed to Anthropic.* Those are ours, and they are labelled
`[LOONG DECISION]` everywhere they appear.

---

## 1. What the reference actually is (verified, S1)

The April 2026 redesign was built for **parallel agents**, not for a better
chat window. Its own words: "many things in flight, and you in the orchestrator
seat." That single sentence sets the target for LOONG.

Documented capabilities, S1 verbatim in intent:

- A **new sidebar for managing multiple sessions** — every active and recent
  session in one place, across multiple repos.
- **Filter by status, project, or environment**, or **group the sidebar by
  project** to find and resume sessions.
- Sessions **self-archive when their PR merges or closes**, "so the sidebar
  stays focused on what's live."
- **Side chat** (`⌘;` / `Ctrl+;`) — branches off a conversation, pulls context
  from the main thread, **adds nothing back**.
- **Drag-and-drop layout**: "Every pane is drag-and-drop. Arrange the terminal,
  preview, diff viewer, and chat in whatever grid matches how you work."
- **Integrated terminal**, **in-app file editor**, a **faster diff viewer**
  rebuilt for large changesets, and **expanded preview** (HTML, PDF, local app
  servers).
- **Plugin parity with the CLI**.
- **Local or cloud sessions**; **SSH** on Mac and Linux.
- **Three view modes — Verbose, Normal, and Summary** — "to dial the interface
  from full transparency into Claude's tool calls to just the results."
- A **usage button showing both the context window and session usage**.
- Responses **stream as they are generated**.

## 2. The application shell (verified, S2)

Claude Code is the **Code tab inside the Claude Desktop app** — not a separate
application. There are **two layouts in the wild** and the docs distinguish them
explicitly (current vs earlier). LOONG must pick one and be consistent; the
current layout is the better target because it is the documented default.

| Feature | Current layout (target) | Earlier layout |
|---|---|---|
| Environment selector | **row under the prompt box** | above the prompt box |
| Saved local/SSH environments | supported, with folders + env vars | not available |
| Worktree toggle | inside the project folder control, under the prompt box | checkbox beside the branch name |
| Session list controls | **hover a heading → Group and sort** | always-visible Filter |
| Archived sessions | **View all → Archived tab** | Status → Archived |
| Context usage | **Context card** in the session details panel | usage ring by the model picker |
| PR/CI monitoring | **Changes card ⋮** | CI button on the status bar |

**Minimum version for the pane layout, terminal, file editor and view modes:
v1.2581.0.** Noted for LOONG as a reminder that this is a moving target; LOONG
should be built against the documented behaviour, not a specific build.

## 3. Panes and workspace arrangement (verified, S2)

**Pane types:** chat, diff, browser, terminal, file, **plan**, **tasks**,
**subagent** — plus an iOS Simulator pane on macOS.

- Drag a pane by its **header** to reposition; drag a pane **edge** to resize.
- Open panes from icon buttons in the **session title bar** (hover reveals the
  name: Terminal, Changes, Browser, Files).
- Anything without a button lives in the **⋮** menu beside them. **Background
  tasks and Plan appear there only once the session has content for them.**
- **When the window is narrow, buttons that don't fit move into the ⋮ menu.**
- A pane can be **popped into its own window** and docked back; "Claude keeps
  working in the main window."

**Session details rail** — a set of cards **beside the chat**:
- **Environment** card — where the session runs, plus the Remote Control switch
- **Changes** card — what it changed, PRs and CI status
- what it is **running**
- **Context** card — usage percentage, openable for a per-category breakdown
- Hidden/shown via **Hide session rail / Show session rail** in the title bar

## 4. The sidebar (verified, S2)

- Lists sessions; several can run **in parallel**.
- **+ New** starts a session (also `Cmd+N` / `Ctrl+N`).
- **Group and sort** icon on hover over a heading; **View all → Archived**.
- **Rename** by clicking the **session title in the title bar**.
- Right-click a session → **Open in → Split view** or **New window**.
- Sessions started from a suggested-task card are listed **under the current
  session**.
- OS **notification when a session finishes and you are not viewing it**.

## 5. Starting a session — the row under the prompt box (verified, S2, S3)

This is the single most important layout fact in the reference, and it is the
one LOONG got wrong for six rounds. **The controls are a row UNDER the prompt
box**, left to right:

1. **Environment** selector — Local, Cloud, SSH, WSL
2. **Project folder** control — click to choose; the **Worktree** toggle lives here
3. **Permission mode** selector — changeable mid-session
4. **Model** picker — toward the right end; changeable mid-session

Then type the task and press **Enter**.

S3 confirms the same row and adds: "Check your permission mode in the row under
the prompt box to see whether Claude waits for your approval."

**In Manual mode, S3 is explicit about what the UI must show:**
1. A diff showing exactly what will change
2. Buttons to approve or decline each change
3. Real-time updates as Claude works through the request

**In Auto or Accept edits**, an indicator such as `+12 -1` appears so the change
can be reviewed in the diff view.

## 6. Interrupting and steering (verified, S2, S3)

- **Stop button** interrupts immediately. `Esc` also stops the response.
- **Or type a correction and press Enter without stopping** — "Claude applies
  it after the current action completes."
- This is a *queue*, and it is the model LOONG should copy: steering never
  requires throwing away work in flight.

## 7. Side chat (verified, S2)

- `Cmd+;` / `Ctrl+;`, or `/btw` in the prompt box.
- "Uses the session's context without adding anything back to the main
  conversation; can read everything in the main thread up to that point."
- **Not saved to disk** — cannot be reopened after closing the app.
- Available in local, SSH and WSL sessions.

## 8. View modes (verified, S2)

Switch from the session menu → **Transcript view**, or cycle with `Ctrl+O`.

| Mode | What it shows |
|---|---|
| **Normal** | Tool calls collapsed into summaries, with full text responses |
| **Thinking** | Collapsed tool calls + Claude's thinking (appears only after thinking exists) |
| **Verbose** | Every tool call, file read, and intermediate step, plus thinking |
| **Summary** | **Removed in 1.46388.1**; a session still on it opens in Normal |

The reference therefore has **three live modes, not four**. A LOONG that ships
a "Summary" mode is shipping something Anthropic retired.

## 9. Keyboard shortcuts (verified, S2 — exact keys)

`Cmd+/` shows the full list. On Windows/Linux: `Cmd+Option`→`Alt`,
`Cmd+Ctrl`→`Ctrl+Alt`, `Cmd`→`Ctrl`. **Session cycling, the terminal toggle and
the view-mode toggle use `Ctrl` on every platform.**

| Action | macOS | Windows/Linux |
|---|---|---|
| Show all shortcuts | `Cmd` `/` | `Ctrl` `/` |
| New session | `Cmd` `N` | `Ctrl` `N` |
| Close session | `Cmd` `W` | `Ctrl` `W` |
| Next / previous session | `Ctrl` `Tab` / `Ctrl` `Shift` `Tab` | same |
| Next / previous session (alt) | `Cmd` `Shift` `]` / `[` | `Ctrl` `Shift` `]` / `[` |
| **Stop the response** | `Esc` | `Esc` |
| Toggle diff pane | `Cmd` `Shift` `D` | `Ctrl` `Shift` `D` |
| Toggle Browser pane | `Cmd` `Shift` `B` | `Ctrl` `Shift` `B` |
| Select an element in the Browser | `Cmd` `Shift` `S` | `Ctrl` `Shift` `S` |
| Toggle terminal | `` Ctrl` `` | `` Ctrl` `` |
| Close focused pane | `Cmd` `\` | `Ctrl` `\` |
| Take out of split view | `Cmd` `Ctrl` `W` | `Ctrl` `Alt` `W` |
| Open side chat | `Cmd` `;` | `Ctrl` `;` |
| Cycle view modes | `Ctrl` `O` | `Ctrl` `O` |
| Permission mode menu | `Cmd` `Shift` `M` | `Ctrl` `Shift` `M` |
| Model menu | `Cmd` `Shift` `I` | `Ctrl` `Shift` `I` |
| Effort menu | `Cmd` `Shift` `E` | `Ctrl` `Shift` `E` |
| Select an item in an open menu | `1`–`9` | `1`–`9` |
| Accept a suggested prompt | `Tab` / `Right arrow` | same |

Note from S2: in Desktop, `Shift+Tab` does **not** cycle permission modes as it
does in the terminal.

## 10. Permission modes (verified, S2)

| Mode | Settings key | Behaviour |
|---|---|---|
| **Manual** | `default` | Asks before editing files or running commands; you see a diff and accept/reject each change |
| **Accept edits** | `acceptEdits` | Auto-accepts file edits and common filesystem commands; still asks before other terminal commands |
| **Plan** | `plan` | Reads and explores, then proposes a plan without editing source code |
| **Auto** | `auto` | Runs without routine prompts; a background classifier checks shell commands and network requests |
| **Bypass permissions** | `bypassPermissions` | No prompts except actions no mode auto-approves; equivalent to `--dangerously-skip-permissions` |

A mode picked in the selector is **remembered per folder** and beats
`defaultMode` — except **Plan**, which is session-only.

## 11. The prompt box (verified, S2, S3)

- `+` button: file attachments, **skills**, **connectors**, **plugins**.
- `@mention` files (`@` + filename).
- Drag-and-drop attachments: images, PDFs, screenshots, mockups, reference docs.
- **Suggested prompts**: gray text after Claude replies; accept with `Tab` or
  `Right arrow`, edit, then `Enter`. Shows only while the box is empty with no
  attachments. Generated from the conversation. Disable in Settings.

## 12. Review surfaces (verified, S2)

**Diff viewer.** Open by clicking the line counts (`+12 -1`) in the Changes
card. **Click any line → comment box → type feedback → Enter.** Submit all
comments at once with `Cmd+Enter` / `Ctrl+Enter`. "Claude reads comments and
makes changes, appearing as a new diff."

**File editor.** Click a file path in chat to open. **Auto save is on by
default** (no Save button). Uncheck it to save manually: Save writes, Cancel
reverts; if the file changed on disk, **Override** writes over it, **Discard**
drops the edits. Cloud/SSH/WSL sessions are **view-only**.

**Terminal.** `Ctrl+`` ` ``. Opens in the session's working directory and
**shares the same environment as Claude** — "`npm test`, `git status` see the
same files Claude edits."

**Browser / preview pane.** Claude can start a dev server and open it to verify
its own changes — frontend apps *and* backend servers. **Auto-verify is on by
default**: screenshots and error checks after every edit. A **Dev servers**
menu starts/stops servers. A clean browser profile with no personal logins.

## 13. Context and usage (verified, S2)

- **Context card** shows a percentage; open it for a per-category breakdown.
- `/context` prints the breakdown in chat.
- **When context fills, Claude auto-summarises and continues**; `/compact`
  triggers summarisation early.
- The usage indicator also shows plan usage, shared across all surfaces.

## 14. What the reference does NOT document (cannot be verified)

- Any pixel dimension: sidebar width, title bar height, pane header height,
  composer height, padding, radius, gap.
- Any font family, font size, line height, or weight.
- Any colour value, surface shade, or border colour.
- Any animation duration, easing curve, or spring constant.
- Any component name, CSS class, or internal architecture.
- Scrollbar styling, focus-ring styling, or icon family.

**Therefore every number in `ui-design-spec.md` and `ui-motion-spec.md` is a
LOONG decision, proposed to satisfy the documented behaviour above.**

## 15. What LOONG should take, and what it should not

### Take
1. **The row under the prompt box.** Environment → folder → permission mode →
   model. It is the reference's most distinctive structural choice and it puts
   the run's settings where the hands already are.
2. **Parallel sessions with split view.** LOONG's backend already forks threads
   (`POST /api/sessions/:id/fork`) and already streams concurrent runs; the UI
   never exposed it.
3. **View modes: Normal / Thinking / Verbose** — exactly three, `Ctrl+O`.
   LOONG's "thoughts" row is a Thinking mode in disguise; make it a mode.
4. **Steer without stopping.** Type a correction, press Enter, it applies after
   the current action. LOONG must queue, not drop.
5. **The session details rail** — Environment / Changes / Running / Context as
   cards beside the chat. LOONG has all four facts in the backend and showed
   none of them.
6. **`+12 -1` as the entry point to the diff.** LOONG has `/api/git/diff` and a
   checkpoints endpoint; neither had a door.
7. **Suggested prompts** as gray text in the empty composer, `Tab` to accept.
8. **Auto-verify** — the browser pane that screenshots after every edit. LOONG
   has `browserTool` and `loong.screenshot` already.
9. **A notification when a run finishes and you are not looking.**

### Do not take
1. **The Summary view mode** — retired by Anthropic in 1.46388.1.
2. **Cloud sessions, SSH, WSL, Dispatch, Remote Control, computer use, PR
   monitoring, cross-session messaging.** LOONG is a local agent over a local
   folder. None of these exist in its backend and none should be faked.
3. **The Claude tab shell** (chat / Cowork / Code). LOONG is one product, not a
   tab inside another.
4. **An environment selector with four options.** LOONG has exactly one
   environment — the folder — and pretending otherwise would be a lie in the UI.
