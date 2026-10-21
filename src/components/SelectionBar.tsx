import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { dur, spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   SelectionBar — do something with what the reader highlighted.

   Select any text in the thread — a message, a line of tool output, a line of
   a diff — and a small hairline bar floats above the selection: explain it,
   ask Loong about it, carry it into the next message as context, or copy it.
   This is the chat-native analogue of Cursor's Cmd+K "act on this selection":
   the selection is never dead, it is always an input.

   It is scoped to a container, so highlighting the composer or the title can
   never raise it. It never steals the selection on the way in: the buttons
   preventDefault their mousedown, so the highlight survives until the action
   lands; the action then clears it, so the bar cannot re-spawn under itself.
   --------------------------------------------------------------------------- */

export type SelectionAction = 'explain' | 'ask' | 'context' | 'copy'

const ACTIONS: { id: SelectionAction; label: string; title: string }[] = [
  { id: 'explain', label: 'explain', title: 'Explain the selection in Ask mode' },
  { id: 'ask', label: 'ask Loong', title: 'Send the selection as a question' },
  { id: 'context', label: 'add to context', title: 'Carry it into your next message' },
  { id: 'copy', label: 'copy', title: 'Copy the selection' },
]

export function SelectionBar({
  container,
  onPick,
}: {
  container: { current: HTMLElement | null }
  onPick: (action: SelectionAction, text: string) => void
}) {
  const reduced = useReducedMotion()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    const hide = () => setPos(null)

    const evaluate = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
      const t = sel.toString()
      if (!t.trim()) return
      const node = sel.anchorNode
      const host = container.current
      /* only text inside the transcript raises the bar — the composer, the
         title and the diff header are all outside it on purpose */
      if (!node || !host || !host.contains(node)) return
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      setText(t)
      setPos({ x: rect.left + rect.width / 2, y: Math.max(rect.top - 10, 52) })
    }

    /* mouseup settles the selection; a timeout lets the browser finish the
       drag before we read the range */
    const onUp = () => window.setTimeout(evaluate, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hide()
      } else if (e.shiftKey && e.key.startsWith('Arrow')) {
        window.setTimeout(evaluate, 0)
      }
    }
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-selection-bar]')) return
      /* a fresh press elsewhere clears the bar; the new mouseup will judged it */
      hide()
    }

    document.addEventListener('mouseup', onUp)
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [container])

  const fire = (action: SelectionAction) => {
    onPick(action, text)
    /* clear the highlight so the menuup that follows a click does not re-raise
       the bar at the same place */
    window.getSelection()?.removeAllRanges()
    setPos(null)
  }

  return (
    <AnimatePresence>
      {pos && (
        <motion.div
          data-selection-bar
          className="fixed z-[70] flex items-center overflow-hidden rounded-[8px]"
          style={{
            left: pos.x,
            top: pos.y,
            translateX: '-50%',
            translateY: '-100%',
            border: '1px solid var(--line-4)',
            background: 'var(--canvas)',
            boxShadow: 'none',
          }}
          initial={reduced ? false : { opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0, y: 4, scale: 0.98 }}
          transition={spring.snap}
        >
          {ACTIONS.map((a, i) => (
            <button
              key={a.id}
              type="button"
              title={a.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fire(a.id)}
              className="mono ctl px-[9px] py-[6px] text-[11px]"
              style={{
                color: 'var(--text-2)',
                borderLeft: i === 0 ? 'none' : '1px solid var(--line-2)',
                borderRadius: 0,
                transition: `color ${dur.hover * 1000}ms var(--ease-out), background-color ${dur.hover * 1000}ms var(--ease-out)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-1)'
                e.currentTarget.style.background = 'var(--surface)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-2)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {a.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
