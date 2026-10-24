# LOONG — Motion & Interaction Specification

**Status:** proposed. Anthropic documents **no animation durations, curves or
spring constants** for Claude Code Desktop (see `ui-reference-research.md`
§14). Every number here is a **LOONG decision**, chosen to be fast enough that
motion never delays interaction.

## Principles

1. **Motion clarifies state change.** If an animation does not tell you
   something changed, it is decoration and it goes.
2. **Entering is slower than leaving.** Something arriving deserves attention;
   something leaving should not hold the door. Dropdown in 200ms / out 150ms,
   modal in 250ms / out 200ms.
3. **Nothing waits on an animation.** Every control is interactive from the
   first frame of its transition.
4. **Reduced motion is a real mode, not a shorter duration.** Under
   `prefers-reduced-motion`, opacity cross-fades only, and the status dot
   communicates by colour and position instead of by blinking.

## Duration tokens

```
--dur-press:    90ms    /* a press, a chip change */
--dur-hover:   140ms    /* hover, colour, border */
--dur-enter:   180ms    /* a row entering the list */
--dur-panel:   240ms    /* a panel sliding, a sidebar opening */
--dur-overlay-in:  250ms
--dur-overlay-out: 200ms
--dur-shimmer: 1500ms   /* the working dot's cycle */
```

## Easing

```
--ease-out:   cubic-bezier(0.22, 1, 0.36, 1)     /* the default: things arriving */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)   /* a thing moving between two places */
--ease-expo:  cubic-bezier(0.16, 1, 0.3, 1)     /* a modal: easeOutExpo */
```

No springs. A spring on a dialog makes the dialog feel like a toy; the reference
is a work tool.

---

## Interaction catalogue

Each entry: **trigger → initial → final → transition → interruption → reduced
motion.**

### 1. Session switch (tab or sidebar row)
- **Trigger:** click a tab, or a sidebar row.
- **Initial:** the current transcript at opacity 1.
- **Final:** the new transcript at opacity 1.
- **Transition:** the outgoing column fades to 0 over `--dur-hover` while the
  incoming fades in from 0 over `--dur-panel`. No slide — a slide implies the two
  are on a shared axis, and they are not.
- **Interruption:** switching again mid-transition swaps immediately; the
  previous fade is cancelled, not queued.
- **Reduced motion:** no fade at all; the content swaps.

### 2. Sidebar collapse / expand
- **Trigger:** the rail's toggle, or the window crossing the narrow breakpoint.
- **Initial:** `width: 280px` (or the persisted width).
- **Final:** `width: 52px` — the rail.
- **Transition:** `width` over `--dur-panel` on `--ease-in-out`. The conversation
  column reflows in the same frame; it does not wait.
- **Interruption:** the drag grip takes over instantly; the animation is
  abandoned mid-flight.
- **Reduced motion:** instant.

### 3. Panel resize (drag a grip)
- **Trigger:** pointer down on a 4px grip, then move.
- **Initial:** the current width.
- **Final:** the pointer's position, clamped to the region's min and max.
- **Transition:** **none.** The region tracks the pointer 1:1. A lagging resize
  is the single most common way a desktop app feels cheap.
- **Interruption:** n/a.
- **Reduced motion:** n/a (there is nothing to reduce).
- **Persistence:** the width is written to storage on pointer-up, not on move.

### 4. Pane pop-out / dock
- **Trigger:** drag a pane's header out of the grid, or back in.
- **Initial:** the pane in the grid.
- **Final:** the pane in its own window, or docked.
- **Transition:** `--dur-panel` scale 0.98 → 1 and opacity 0 → 1 on the target
  window. The source grid reflows instantly.
- **Interruption:** dropping mid-transition completes it.
- **Reduced motion:** instant.

### 5. Dropdown / popover (model picker, folder picker, ⋮ menu)
- **Trigger:** click the control.
- **Initial:** opacity 0, `translateY(-4px)`, `scale(0.98)`.
- **Final:** opacity 1, `0`, `1`.
- **Transition:** in `200ms` `--ease-out`; out `150ms` `--ease-in`.
- **Interruption:** `Esc` closes immediately, no exit animation.
- **Reduced motion:** opacity only, 90ms.

### 6. Dialog (settings, new project, confirm)
- **Trigger:** a command that needs a decision.
- **Initial:** opacity 0, `translateY(10px)`, `scale(0.99)`. The scrim fades in
  over 200ms.
- **Final:** opacity 1, `0`, `1`.
- **Transition:** in `250ms` `--ease-expo`; out `200ms` `--ease-in`.
- **Interruption:** `Esc` or a scrim click closes immediately.
- **Reduced motion:** opacity only.

### 7. Composer focus
- **Trigger:** focus enters the textarea.
- **Initial:** border `--line-2`.
- **Final:** border `--line-4`, plus the focus ring.
- **Transition:** `border-color` over `--dur-hover` on `--ease-out`.
- **Interruption:** blur reverses it.
- **Reduced motion:** instant colour change (no transition), ring still appears.

### 8. Send → Stop
- **Trigger:** the run starts.
- **Initial:** the send button.
- **Final:** the stop button.
- **Transition:** a 90ms cross-fade in place. **The button never moves and never
  changes size** — a control that jumps under the cursor is a control that gets
  mis-clicked.
- **Interruption:** the run ending reverses it.
- **Reduced motion:** instant swap.

### 9. Streaming text
- **Trigger:** `TEXT_MESSAGE_CONTENT` deltas arrive.
- **Initial:** the block grows.
- **Final:** the block is complete.
- **Transition:** **none.** Text appears as it arrives. A per-character
  animation is both slower than the network and impossible to read.
- **Interruption:** n/a.
- **Reduced motion:** n/a.

### 10. A tool activity row entering
- **Trigger:** `TOOL_CALL_START`.
- **Initial:** `opacity 0`, `height 0`.
- **Final:** `opacity 1`, `height auto`.
- **Transition:** `--dur-enter` `--ease-out`, height via `auto` (the layout
  animation, not a measured height).
- **Interruption:** the next row does not wait for this one; rows queue their
  own entry independently.
- **Reduced motion:** the row appears with no height animation.

### 11. A tool row collapsing / expanding
- **Trigger:** click the row.
- **Initial:** its current height.
- **Final:** `auto` or the collapsed height.
- **Transition:** `--dur-panel` `--ease-in-out`, `overflow: hidden`.
- **Interruption:** clicking again mid-collapse reverses it from the current
  height.
- **Reduced motion:** instant.

### 12. Thinking rows
- **Trigger:** the thinking count grows, or the row is clicked.
- **Initial:** one folded row.
- **Final:** the rows expanded in place.
- **Transition:** `--dur-panel` height, `--ease-in-out`.
- **Interruption:** reversible.
- **Reduced motion:** instant.

### 13. Approval requested
- **Trigger:** `loong.approval_requested`.
- **Initial:** the card is not there.
- **Final:** the card is at the end of the transcript, its edge `--line-4`.
- **Transition:** `--dur-enter` fade + 8px rise. **The card does not slide over
  other content** — it takes its place in the flow and the transcript scrolls to
  it if it is below the fold.
- **Interruption:** a second approval appends below the first; they do not stack
  on top of each other.
- **Reduced motion:** appears in place.

### 14. Approval resolved
- **Trigger:** `loong.approval_resolved`.
- **Initial:** edge `--line-4`, both buttons.
- **Final:** edge `--line-2`, the decision shown as text.
- **Transition:** `--dur-hover` on the border colour. **The card does not
  disappear** — a resolved approval is the record that the reader decided.
- **Interruption:** n/a.
- **Reduced motion:** instant.

### 15. Plan step completing
- **Trigger:** the step's status changes.
- **Initial:** marker `--line-3`.
- **Final:** marker `--text-1`.
- **Transition:** `--dur-hover` colour. No checkmark draws itself.
- **Interruption:** n/a.
- **Reduced motion:** instant.

### 16. Question card
- **Trigger:** `loong.question`.
- **Initial:** not present.
- **Final:** present at the end of the transcript, focused.
- **Transition:** `--dur-enter`. The input takes focus **after** the card is in
  place, so the scroll and the focus do not fight.
- **Interruption:** n/a.
- **Reduced motion:** appears in place.

### 17. Run finishing
- **Trigger:** `finish` or `RUN_ERROR`.
- **Initial:** the status dot blinking, `Loong · working`.
- **Final:** the dot hollow, `idle`.
- **Transition:** `--dur-hover`.
- **Interruption:** n/a.
- **Reduced motion:** instant; the state is still legible from the colour.

### 18. Retry after a failure
- **Trigger:** click **Retry**.
- **Initial:** the failure line.
- **Final:** the run bar returns, a new run starts.
- **Transition:** `--dur-enter`. The failure line stays in the transcript as
  history — a retry that erases the error hides the reason.
- **Interruption:** n/a.
- **Reduced motion:** instant.

### 19. Diff pane opening
- **Trigger:** click `+N −N` in the Changes card, or the Changes pane button.
- **Initial:** the pane is closed.
- **Final:** the pane is open, sized from its persisted width.
- **Transition:** `--dur-panel` width on `--ease-in-out`; the conversation
  column reflows in the same frame.
- **Interruption:** closing mid-open reverses from the current width.
- **Reduced motion:** instant.

### 20. Search / command palette
- **Trigger:** `Cmd/Ctrl+K`.
- **Initial:** the scrim at 0, the palette at opacity 0, `scale(0.98)`.
- **Final:** the scrim at 1, the palette at 1.
- **Transition:** in `200ms` `--ease-out`; out `150ms` `--ease-in`.
- **Interruption:** `Esc` closes immediately. Results re-filter on every
  keystroke with no transition — a filtered list that animates feels slow.
- **Reduced motion:** opacity only.

### 21. Notification (run finished, not viewing)
- **Trigger:** the run finishes and the window is not focused.
- **Initial:** nothing.
- **Final:** an OS notification.
- **Transition:** the OS's own.
- **Interruption:** n/a.
- **Reduced motion:** the OS's own.

---

## Implementation

The reference documents no library. LOONG's previous build used **Framer
Motion** (`motion/react`), which is already a dependency and already handles
`prefers-reduced-motion` through `MotionConfig`. **Keep it.**

Rules for its use:

- Duration and easing come from the tokens above. No ad-hoc numbers in a
  component.
- Layout animations (`height: auto`, `width`) use the `layout` prop, never a
  measured pixel height.
- `AnimatePresence` wraps anything that leaves, so exits are not abrupt.
- `initial={false}` on anything already on screen at mount, so opening the app
  does not replay every entrance.
- One animation in flight per element. Two competing animations on the same
  property is a bug, not a flourish.

## Performance constraints

- No animation runs on a property that triggers layout, except a deliberate
  `height: auto`/`width` collapse, and those are capped at `--dur-panel`.
- Streaming text is never animated. The stream re-renders on every delta and an
  animation per delta is a dropped frame per delta.
- The status dot's blink is the only infinite animation in the product, it is a
  single `opacity` keyframe, and it stops under reduced motion.
- A pane resize tracks the pointer at 1:1 with no transition.
