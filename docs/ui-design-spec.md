# LOONG — UI Design Specification

**Status:** proposed. Nothing here is built. Every number is a **LOONG
decision**, chosen to satisfy the documented reference behaviour in
`ui-reference-research.md` — Anthropic publishes no pixel values, so none of
these can be attributed to them.

**Palette direction (final, from Prof):** pure white and black. The only grey
in the product is the text selection. No warm greys, no tinted surfaces, no
accent colour. Rationale: a `#E5E3DE` divider on white is a suggestion, and a
tinted bubble is a stain; a hairline is an edge you can see without a border
you can feel.

---

## 1. Design tokens

### 1.1 Colour — pure monochrome

```
--canvas:            #ffffff   /* the app, the main column, the composer */
--surface:           #ffffff   /* every panel: sidebar, rail, status bar */
--surface-raised:    #ffffff   /* a card on the canvas */
--surface-sunken:    #ffffff   /* a well, a disabled field */
--surface-selected:  #f2f2f2   /* the row you are on */
--surface-hover:     #f7f7f7   /* the row under the pointer */
--selection:         #d9d9d9   /* THE ONLY GREY — it marks, it does not become */
```

**Ink ladder — measured, each rung annotated with its contrast ratio on white.**

```
--text-1:  #000000   21.0:1   /* the ink: headings, body, anything you must read */
--text-2:  #2e2e2e   12.6:1   /* secondary copy */
--text-3:  #4a4a4a    8.6:1   /* labels, metadata, captions */
--text-4:  #5f5f5f    5.9:1   /* the faintest tier — still above AA */
```

The faintest tier used to sit at 3.45:1 in a previous build, and it was carrying
the run bar, the message eyebrows, the failure line and every composer chip.
That is the failure this ladder exists to prevent. **No rung may go below
4.5:1.** This is enforced by `scripts/contrast.mjs`, which must stay in the
repo and must stay green.

**Hairlines — black at five alphas.**

```
--line-1: rgba(0,0,0,0.11)   /* a divider: sidebar edge, row separators */
--line-2: rgba(0,0,0,0.18)   /* a control's resting edge */
--line-3: rgba(0,0,0,0.24)   /* a control's focused edge */
--line-4: rgba(0,0,0,0.42)   /* an edge that must be seen */
--line-5: rgba(0,0,0,0.72)   /* a rule */
```

### 1.2 Geometry

```
--titlebar-h:     40px    /* session tabs, pane buttons, the usage button */
--statusbar-h:    36px    /* the floor: state, mode, plan, model, tokens, folder */
--sidebar-w:      280px   /* drag 240–400; double-click the grip resets */
--thread-measure: 720px   /* the conversation column */
--rail-w:          52px   /* the collapsed sidebar */
```

Radii are **named for what they are used on**, not on an abstract scale:

```
--radius-badge:   4px
--radius-btn:     8px
--radius-card:   12px
--radius-input:  12px
--radius-chat:   16px    /* the composer */
--radius-modal:  16px
```

Shadows — the only two in the system, and both neutral:

```
--shadow-overlay: 0 4px 12px rgba(0,0,0,0.08)   /* dropdowns, popovers */
--shadow-modal:   0 8px 32px rgba(0,0,0,0.12)   /* dialogs */
```

### 1.3 Typography

Two cuts of one family: **Inter** for body, **Inter Display** for headings.
Code is **Berkeley Mono → JetBrains Mono → Cascadia Mono → Consolas → SF Mono**.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `.t-h1` | 24 / 32 | 700 | the screen title |
| `.t-h2` | 18 / 24 | 600 | a section title |
| `.t-h3` | 16 / 22 | 600 | a card title |
| `.t-body` | 14 / 20 | 400 | the conversation, the default |
| `.t-small` | 13 / 18 | 400 | secondary copy, code |
| `.t-caption` | 12 / 16 | 400 | labels, metadata |
| `.t-tiny` | 11 / 14 | 500 | eyebrows, status, chips |
| `.t-code` | 13 / 18 | 400 | monospace |

Each rung carries its own line-height and weight. A 13px at 400 is not a 12px at
500, and the ladder is the only source of type sizes in the product.

### 1.4 Spacing

A 4px base grid: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`. Page margin is 40 in
the reference's spirit and 24 in LOONG's — the window is smaller and the
conversation column is already constrained by `--thread-measure`.

---

## 2. The shell

Four regions, fixed, in this order:

```
┌──────────────────────────────────────────────────────────────┐
│ TITLE BAR  40px   tabs · pane buttons · view mode · usage    │
├───────────┬──────────────────────────────────┬───────────────┤
│ SIDEBAR   │ CONVERSATION COLUMN  720px       │ SESSION RAIL  │
│ 280px     │  ┌────────────────────────────┐  │ 240px         │
│           │  │ run bar                    │  │ Environment   │
│  Home     │  │ transcript                 │  │ Changes       │
│  Projects │  │                            │  │ Running       │
│   folder  │  └────────────────────────────┘  │ Context       │
│    session│  ┌────────────────────────────┐  │               │
│           │  │ the row under the prompt    │  │               │
│           │  │ PROMPT                     │  │               │
│           │  │ folder · mode · model      │  │               │
│           │  └────────────────────────────┘  │               │
├───────────┴──────────────────────────────────┴───────────────┤
│ STATUS BAR  36px   ● idle · agent · plan 3/8 · model · tok  │
└──────────────────────────────────────────────────────────────┘
```

The conversation column is centred in whatever space is left, so a narrow window
narrows the margins before it narrows the measure.

---

## 3. Component inventory

### 3.1 Sidebar (280px, drag 240–400)

- **Head:** the word `WORKSPACE` in `.t-tiny`, uppercase, `letter-spacing .14em`,
  `--text-4`. No logo — the mark lives in the window.
- **Home** — a row, `.t-small`, opens a fresh session.
- **Projects** — a label with a `+` (new project) and a search icon beside it.
- **A project row** — the folder's leaf name, `.t-small`, with a `−`/`+` fold
  marker and the session count. The active project is `--text-1` on
  `--surface-selected`; the rest are `--text-2`.
- **A session row** — the session title `.t-small`, and under it the relative
  time in `.t-tiny` `--text-4`. A 6px dot on the left: filled `--text-1` and
  blinking while running, hollow `--line-3` when idle. `padding: 8px 12px`.
- **Footer:** **Memory**, **Settings**. Not Sound — sound lives in Settings, and
  a duplicate control is a second place to disagree.
- **Grip:** a 4px strip on the right edge, `cursor: col-resize`, double-click to
  reset to 280.
- **Empty state:** a sentence and a **New thread** button. An empty list is an
  invitation, not a statement.

### 3.2 The row under the prompt box

The reference's signature structure, and the one LOONG must copy. Left to right:

| Control | Content |
|---|---|
| **Folder** | the project's leaf name, click to change. Icon + truncated text |
| **Mode** | `Agent` / `Plan` / `Ask` — a three-chip segmented control |
| **Trust** | `Ask first` / `Full trust` — a two-chip segmented control |
| **Model** | the model that will run, truncated, click to open the picker |

Each chip is `.t-tiny`, `padding: 2px 7px`, `--radius-badge`, resting border
`--line-2`, active border `--line-3` on `--surface-selected`. **Active chips
carry `--text-1`; resting chips carry `--text-4`.** Every chip has an
`aria-label` and `aria-pressed`.

### 3.3 The prompt (composer)

```
max-width:        720px, centred
border:           1px --line-2 → --line-4 on focus
radius:           16px
background:       --canvas
padding:          16px 16px 48px 16px   /* the 48px bottom band holds the controls */
textarea:         rows=1, auto-grow, min-height 42, max-height 240, --t-body
```

The bottom band holds, left to right: `+` (attach, 24px, radius 6), the mode
chips, the trust chips, the model, and at the far right the **send** button —
or the **stop** button while running. `⏎ send · ⇧⏎ newline` in `.t-tiny`
`--text-4` sits above the band on the right.

**Attachments** render as 44px thumbnails with a remove affordance. Drag-and-drop
anywhere on the composer attaches.

**Suggested prompts** — the reference's behaviour: gray text after the agent
replies, only while the box is empty, `Tab` or `→` to accept.

### 3.4 The transcript

- **The reader's message** — right-aligned, `max-width: 70%`, `--radius-chat`
  with the bottom-right corner at 4px, `padding: 10px 14px`, background
  `--canvas` with a `--line-2` edge (not a tinted bubble). An eyebrow `You` in
  `.t-tiny` `--text-4`.
- **The agent's message** — the page itself, full width, no card. An eyebrow
  `Loong` in `.t-tiny` `--text-4`, which becomes `Loong · working` while the
  block streams.
- **The run bar** — sits above the transcript, one line: the goal (truncated,
  `title` carries the full text), then `ctx 0% · ≈14 tok`, then the cost when
  known. Border `--line-1`, background `--canvas`.
- **Tool activity** — collapsed by default into a single row per tool: icon,
  the tool name, a one-line summary, the duration. Click to expand. A tool group
  folds into one row with a count (`3 TOOLS`). **No chevrons, no arrows** — the
  row's hover state is the affordance.
- **Thinking** — folded into one row (`7 THOUGHTS · 7.8K CHARS`) that expands in
  place. Not a separate view mode by default; see §5.
- **The plan** — `plan 0/9` in the run bar; expanded, a numbered list of steps
  with a 6px state marker each: done `--text-1`, running `--text-1` blinking,
  pending `--line-3`.
- **Approval card** — the tool name, the title, the detail, and **the diff**.
  Two buttons: **Approve** (`--btn-primary`) and **Decline**. The card's edge is
  `--line-4` while it waits and `--line-2` once resolved.
- **Question card** — the question, the options as chips, and a free-text field.
- **Failure** — one line in `--text-1`, the reason, and a **Retry** button. Never
  a red box: there is no red in the palette.

### 3.5 Session rail (240px, beside the chat)

Four cards, in the reference's order, each `--radius-card`, `--line-1` edge:

1. **Environment** — the folder path, and a **Change** button.
2. **Changes** — `+N −N` from `/api/git/diff`, click to open the diff pane.
3. **Running** — the live tool and its elapsed time, or `idle`.
4. **Context** — the percentage, and a per-category breakdown when opened.

Hide/show from the title bar. When the window is narrow it collapses to a button.

### 3.6 Status bar (36px)

One dot and one word, then the facts, pushed right: mode · plan `n/n` · the
model that RAN · tokens of the last run · the folder. All read from the live
stream. The dot blinks on a 1.5s cycle only while working and is still under
reduced motion.

### 3.7 Title bar (40px)

Session **tabs** (one per open session, `.t-small`, active on
`--surface-selected`, radius 8, padding 6px 12px, gap 4px), then the pane
buttons (Terminal, Changes, Browser, Files) as icons, then **⋮** for the panes
that have no button, then the **view mode** control, then the **usage** button.
When the window is narrow, the buttons that don't fit move into **⋮**.

### 3.8 Controls

| Variant | Resting | Hover | Active | Disabled |
|---|---|---|---|---|
| **Primary** | `#000` bg, `#fff` text | `#2d2d2d` | `#1d1d1d` | `#d0d0d0` bg, `#999` text |
| **Secondary** | white bg, `--line-2` edge, `--text-1` | `--surface-hover` | `--surface-selected` | `--surface-sunken`, `--text-4` |

Focus ring: `0 0 0 3px rgba(0,0,0,0.12)` on a `--line-4` edge. Every interactive
element has one, and it is never removed.

### 3.9 Empty, loading and error states

- **No sessions:** a sentence and a **New thread** button.
- **No folder chosen:** the folder control reads `Choose a folder…` and the
  prompt is disabled with the reason in the placeholder.
- **No API key / model:** the composer is disabled and the reason is stated in
  the row, not in a modal.
- **Agent offline:** the status bar dot is hollow and reads `idle`, and the
  health card in Settings says `not running` with the reason.
- **Streaming:** the send button becomes the stop button; the status dot blinks.
- **A run fails:** one line in the transcript with the reason and a **Retry**
  button. The trace id is in the title attribute.
- **No search results:** `Nothing matches that.`

### 3.10 Scrollbars

6px, thumb `--line-3`, track transparent, radius 3. Visible on hover only.

---

## 4. Iconography

One family, one weight. **1.5px stroke**, 16px default, 12px in dense rows, 20px
in the title bar. Optical alignment on a 4px grid, never mathematical centring.
The reference documents no icon family; LOONG uses its own drawn set because a
generic set reads generic.

**No chevrons, no arrows, no carets anywhere.** Prof's instruction, and it is
also better design here: a row that needs an arrow to say it opens is a row that
has not been designed. The affordance is the hover state and the cursor.

---

## 5. View modes (exactly three)

`Ctrl+O` cycles. The reference retired Summary in 1.46388.1; LOONG does not
ship it.

| Mode | Shows |
|---|---|
| **Normal** | tool calls collapsed into summaries, full text responses |
| **Thinking** | collapsed tool calls + the thinking rows expanded |
| **Verbose** | every tool call, every file read, every intermediate step, plus thinking |

The current default is **Normal**. The mode is per-session and persists.

---

## 6. Accessibility requirements

- Every interactive element has an accessible name. **Enforced by the audit
  script**, which must report zero unnamed controls.
- Every text rung is ≥ 4.5:1 on its background; large text ≥ 3:1. **Enforced by
  `scripts/contrast.mjs`.**
- Full keyboard operation: `Tab` order follows the visual order; `Esc` stops a
  run; `Cmd/Ctrl+/` opens the shortcut sheet.
- `prefers-reduced-motion` disables every non-essential transition. The status
  dot still communicates state, by colour and position, not by motion.
- Focus is visible on everything, always.
- Bidirectional text (`dir="auto"`) on every user- and agent-authored string.
