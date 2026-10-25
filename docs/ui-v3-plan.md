# LOONG — v3: verified defects, the new structure, and the animation plan

**Date:** 25 Oct 2026
**Status:** verified against the source, not from memory. Every line reference below
was read in the file it names.

---

## 1. The defects you reported — confirmed

### Functional

| # | Defect | Where | Why it happens |
|---|---|---|---|
| F1 | **The mode menu eats keys 1–4 globally** | `ModeMenu.tsx:78` | `window.addEventListener('keydown')` while open. Typing "2" anywhere picks a mode. |
| F2 | **Rename commits twice** | `Sidebar.tsx:251` + the `onKeyDown` Enter branch | `onBlur` and Enter both call `commitRename`, and Enter also blurs the field. |
| F3 | **A failed key save says nothing** | `SettingsPanel.tsx:85` | `await api.putKeys(...).catch(() => null)` — the null is never inspected. |
| F4 | **A tool row cannot be opened** | `Transcript.tsx:60` | `const open = controlled ?? local` — passing `open={verbose || b.ok === false}` makes it *controlled*, and the click handler only writes `local`. **The row is dead.** |
| F5 | **Tools appear abruptly** | `Transcript.tsx` tool case | The row is a plain `div` with no entry transition. |
| F6 | **The composer loses focus when the language changes, and copy/paste does not work** | `App.tsx` (two `{composer}` call sites) + `Composer.tsx` | **Two causes.** (a) The composer is rendered in *two different places* in the tree — centred when empty, at the floor when not — so React unmounts and remounts it the moment the first message is sent. (b) The textarea is **controlled**, so an IME composition is overwritten mid-composition by a re-render. |

### Visual

| # | Defect | Where | Why |
|---|---|---|---|
| V1 | **A grey square appears around the field on focus** | `global.css:99` (3px `rgba(0,0,0,.12)`) **and** `Composer.tsx:80` (3px `rgba(0,0,0,.05)`) | Two rings stacked. The outer one is square-ish at 22px radius and reads as a box. |
| V2 | **The composer is not round** | `tokens.css` `--radius-chat: 22px` | At a 46px minimum height a pill needs 23px, and the *bottom* corners must stay round too. |
| V3 | **The mode menu overflows the right edge** | `ModeMenu.tsx` | `left: Math.max(12, anchor.x)` with a fixed 336px width, no `innerWidth` clamp. |
| V4 | **The session menu is invisible with one session** | `Sidebar.tsx:167` | The menu is `absolute` inside `overflow-y-auto`; the scroll container clips it. With one session the container is short, so the menu is cut to nothing. |
| V5 | **Composer controls collide on a narrow window** | `Composer.tsx` | No `flex-wrap`; five controls in a fixed 44px row. |
| V6 | **The palette does not follow the keyboard** | `CommandPalette.tsx` | No `scrollIntoView` — the selected row can be below the fold. |
| V7 | **The top-right of the header is ugly and collides** | `App.tsx` | `normal · thinking · verbose` as three permanent chips plus a lone `H`. They take fixed width and fight the folder title. |
| V8 | **A custom provider has no Base URL field** | `SettingsPanel.tsx` | Only a key input exists. |

---

## 2. Defects I found that you did not list

| # | Defect | Where | Why it matters |
|---|---|---|---|
| X1 | **The composer remounts on the first send** | `App.tsx`, `{composer}` twice | This is the *same* root cause as F6a: focus, scroll position and the caret all reset. One composer, one place in the tree, positioned by CSS — not by JSX branch. |
| X2 | **No auto-scroll while streaming** | `App.tsx` transcript container | A long answer grows below the fold and the reader has to chase it. |
| X3 | **`Home` and `New session` do the same thing** | `App.tsx` | Both clear the thread. `Home` has no meaning of its own — which is exactly your point. |
| X4 | **A session's `workspace` groups it under a project** | `Sidebar.tsx` | There is no project entity in the backend; the grouping is invented by the interface. |
| X5 | **`notice` never dismisses itself** | `App.tsx` | A toast that stays is a banner. |
| X6 | **The palette's project rows all open the folder picker** | `CommandPalette.tsx` | Clicking a project name should open that project's sessions, not the OS dialog. |
| X7 | **`StatusBar` receives `model` but no longer renders it** | `StatusBar.tsx` | Dead prop left behind after the model moved into the composer. |
| X8 | **`Fold` re-mounts on every transcript change** | `Transcript.tsx` | The open state lives in local state keyed by nothing; a streaming update can reset an open row. |

---

## 3. The structure you asked for

Three surfaces, and only three. The current build has them tangled.

```
┌─ Home ────────────────────────────────────────────────┐
│ plain conversation with the model. No folder, no tools.│
│ Its threads appear in CONVERSATIONS, not in sessions.  │
└───────────────────────────────────────────────────────┘
┌─ Code ────────────────────────────────────────────────┐
│ the agent. You pick a FOLDER from the control under the │
│ composer. That pick starts a SESSION. A session is a    │
│ conversation with a folder — it is not a child of a     │
│ "project", because a project does not exist.            │
└───────────────────────────────────────────────────────┘
```

- **Home** — a chat. Threads are listed under **Conversations**, named by their
  own title, with nothing else attached.
- **Code** — the agent. The folder control under the composer is the only place
  a folder is chosen; choosing one starts a session.
- **No Projects.** Removed from the interface entirely. A session carries a
  `workspace` because the backend needs one, but the sidebar shows sessions,
  not projects.
- **Scheduled** — removed.
- **Customize** — removed.
- **Memory** — removed from the interface. The agent keeps what it learns; it
  does not show a list and it does not ask permission for each fact.

---

## 4. Ready solutions for each defect

| Defect | The fix, and why it is the right one |
|---|---|
| F1 | Scope the listener to the menu element (`onKeyDown` on the container with `tabIndex={-1}` and focus it on open). A global listener is a listener on the whole app. |
| F2 | A `committed` ref: the first caller wins, the rest are ignored. Standard guard for a field that commits on both Enter and blur. |
| F3 | Keep the error and render it in the row: `saved` becomes `{ ok: boolean; text: string }`. A silent catch is a lie by omission. |
| F4 | `Fold` becomes **uncontrolled by default**: `open` is only an *initial* value (`useState(open)`), and the row always toggles. A controlled row with no setter is a disabled control. |
| F5 | Enter with `initial={{ opacity: 0, y: 4, height: 0 }}` → `animate={{ opacity: 1, y: 0, height: 'auto' }}`, 180ms `ease-out`. The same transition the transcript already uses. |
| F6 | **One composer, one position.** The textarea becomes **uncontrolled** (`defaultValue` + a ref) so no re-render can rewrite it mid-composition; the value is read from the ref on send. That fixes IME *and* paste *and* the caret. |
| V1 | Delete the outer ring on the composer entirely. Focus is a border colour change only — the field is already a 23px pill, and a ring around a pill is a box. |
| V2 | `--radius-chat: 23px` and the composer's own `borderRadius` set to `999px` at rest; the field grows in height, the radius stays a pill. |
| V3 | Position the menu in a **portal** with `position: fixed`, clamped to `innerWidth - width - 12`. |
| V4 | Same portal. A menu inside a scroll container is a menu that gets cut. |
| V5 | `flex-wrap` on the band, and the model chip truncates before the mode chip does. |
| V6 | `scrollIntoView({ block: 'nearest' })` on the cursor row whenever the cursor moves. |
| V7 | The header keeps **only** the sidebar toggle, the title, and two icon buttons. View mode moves into a `⋯` menu; the three chips are gone. |
| V8 | A Base URL field appears for `custom`, stored next to the key in `server/keys.ts` (`baseUrl` per provider). |
| X2 | A `useEffect` that pins to the bottom when the reader is already near it, and does not yank them if they have scrolled up. |

---

## 5. The animation plan

The brief is "animation that matches the reference". The reference's motion is
small and fast; nothing bounces, nothing slides across the screen.

| Moment | Motion |
|---|---|
| App open | The four regions fade in as one, 240ms. The creature fades and rises 8px. |
| Sidebar show/hide | Width 240ms `cubic-bezier(.65,0,.35,1)`. Content does not reflow separately. |
| Session switch | Outgoing transcript 120ms out, incoming 200ms in. No slide. |
| Sidebar fold | Height 240ms, opacity 160ms. |
| Dropdown / menu | In: 200ms `ease-out` from `y:-4, scale:.98`. Out: 150ms. |
| Modal | In 250ms `cubic-bezier(.16,1,.3,1)`. Out 200ms `ease-in`. |
| Composer focus | Border colour 140ms. **No ring, no scale.** |
| Send → Stop | Cross-fade 120ms in place; the button never moves. |
| Streaming text | No animation. A 2px caret blinks at 1.05s. |
| A tool row arriving | `opacity 0→1`, `y 4→0`, `height 0→auto`, 180ms. |
| A tool row opening | Height 240ms. |
| Approval card | `opacity 0→1`, `y 8→0`, 180ms; the border settles 140ms after the decision. |
| Plan step done | Marker colour 140ms. No checkmark drawing itself. |
| The creature | Breathing 3.4s; blink every ~5.6s; working = 2.5px bob at 1.1s. |
| Reduced motion | Opacity only. The caret stops blinking and stays visible. |

---

## 6. Order of work

1. **Structure** — Home / Code / Conversations / Sessions; remove Projects,
   Scheduled, Customize, Memory.
2. **The composer** — one instance, uncontrolled textarea, pill, no ring.
3. **The dead controls** — `Fold` opens, menus in a portal, palette follows the
   keyboard.
4. **The header** — strip it to three things.
5. **Keys** — Base URL for a custom provider, and a visible failure.
6. **The model picker** — a real picker in the composer with a "custom model"
   row at the end.
7. **Animation** — the table above, applied everywhere.
8. **Verify** — the audit probe on three sizes, a driven run, screenshots.

---

## 7. The icon

`C:\Users\Hamza\Downloads\icon.jpg` is no longer on disk, and the PNG you
mentioned is not there either. The six PNGs generated from the JPEG are still in
`public/icon/` and are valid. **Drop the new PNG at
`C:\Users\Hamza\Desktop\LOONG\public\icon\icon-256.png` and it will be used** —
the build copies it and electron-builder derives the `.ico` from it.
