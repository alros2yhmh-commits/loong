import { useEffect } from 'react'
import { motion } from 'motion/react'
import type { Mode, Trust } from './Composer'

/* ===========================================================================
   The permission menu.

   The reference's shape: a small list of numbered choices, each with the number
   that selects it, a line saying what it does, and a check on the current one.
   A menu that explains the choice is worth more than one that names it.
   =========================================================================== */

const CHOICES: { n: number; label: string; detail: string; mode: Mode; trust: Trust }[] = [
  {
    n: 1,
    label: 'Ask permissions',
    detail: 'Every write and command waits for you, with the diff.',
    mode: 'agent',
    trust: 'ask',
  },
  {
    n: 2,
    label: 'Plan mode',
    detail: 'Reads and explores, then proposes a plan. It cannot write.',
    mode: 'plan',
    trust: 'ask',
  },
  {
    n: 3,
    label: 'Full trust',
    detail: 'Writes run without asking. The confidence gate still parks what it doubts.',
    mode: 'agent',
    trust: 'auto',
  },
  {
    n: 4,
    label: 'Conversation only',
    detail: 'No tools, no reading, no changes. Just the model.',
    mode: 'ask',
    trust: 'ask',
  },
]

export function ModeMenu({
  open,
  onClose,
  mode,
  trust,
  onPick,
  anchor,
}: {
  open: boolean
  onClose: () => void
  mode: Mode
  trust: Trust
  onPick: (mode: Mode, trust: Trust) => void
  anchor?: { x: number; y: number } | null
}) {
  /* 1–4 select and Esc closes — but only while this menu has the focus. A
     listener on the window is a listener on the whole app, and a reader typing
     "2" in the composer must not change their permission mode. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (!el || !el.closest('[data-mode-menu]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      const n = Number(e.key)
      if (n >= 1 && n <= 4) {
        const c = CHOICES[n - 1]
        if (c) {
          e.preventDefault()
          onPick(c.mode, c.trust)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onPick])

  if (!open) return null

  const isCurrent = (c: (typeof CHOICES)[number]) =>
    c.mode === mode && c.trust === trust

  return (
    <div className="fixed inset-0 z-[75]" onMouseDown={onClose}>
      <motion.div
        data-mode-menu
        tabIndex={-1}
        ref={(el) => el?.focus()}
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="absolute w-[336px] overflow-hidden rounded-[14px] p-[5px] outline-none"
        style={{
          /* clamp both axes: a 336px menu opened near the right edge used to
             lose its last 100px off the screen */
          left: Math.max(12, Math.min(anchor?.x ?? 200, window.innerWidth - 336 - 12)),
          bottom: anchor ? Math.max(12, window.innerHeight - anchor.y + 8) : 120,
          background: 'var(--canvas)',
          border: '1px solid var(--line-3)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {CHOICES.map((c) => (
          <button
            key={c.n}
            type="button"
            onClick={() => {
              onPick(c.mode, c.trust)
              onClose()
            }}
            className="ctl flex w-full items-start gap-[10px] rounded-[9px] px-[10px] py-[9px] text-left"
            style={{ background: isCurrent(c) ? 'var(--surface-selected)' : 'transparent' }}
          >
            <span className="mono mt-[1px] w-[10px] shrink-0 t-tiny" style={{ color: 'var(--text-4)' }}>
              {c.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block t-small" style={{ color: 'var(--text-1)' }}>
                {c.label}
              </span>
              <span className="block t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
                {c.detail}
              </span>
            </span>
            {isCurrent(c) && (
              <span className="mt-[2px] shrink-0 t-small" style={{ color: 'var(--text-1)' }}>
                ✓
              </span>
            )}
          </button>
        ))}
      </motion.div>
    </div>
  )
}
