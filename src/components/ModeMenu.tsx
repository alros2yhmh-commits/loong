import { useEffect } from 'react'
import { motion } from 'motion/react'
import { t, e } from '../lib/motion'
import type { Mode, Trust } from './Composer'

/* ===========================================================================
   The permission menu.

   No numbers. A number is a keyboard shortcut pretending to be a label — it
   tells you what to press before it tells you what the thing does. Each row
   now leads with a glyph, then the name, then the consequence, and the current
   one is marked.

   Keys 1–4 still work, but they are a bonus for the reader who already knows
   the list, not the thing the list is built around.
   =========================================================================== */

interface Choice {
  label: string
  detail: string
  mode: Mode
  trust: Trust
  glyph: React.ReactNode
}

const ICON = (d: string) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d={d} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const CHOICES: Choice[] = [
  {
    label: 'Ask first',
    detail: 'Every write and command waits for you, with the diff.',
    mode: 'agent',
    trust: 'ask',
    glyph: ICON('M8 2.4l4.6 2.2v3.6c0 2.8-1.9 4.9-4.6 5.8-2.7-.9-4.6-3-4.6-5.8V4.6L8 2.4z'),
  },
  {
    label: 'Plan',
    detail: 'Reads and explores, then proposes a plan. It cannot write.',
    mode: 'plan',
    trust: 'ask',
    glyph: ICON('M3.4 4.2h9.2M3.4 8h9.2M3.4 11.8h5.6'),
  },
  {
    label: 'Full trust',
    detail: 'Writes run without asking. The confidence gate still parks what it doubts.',
    mode: 'agent',
    trust: 'auto',
    glyph: ICON('M8 2.2v11.6M2.2 8h11.6'),
  },
  {
    label: 'Chat only',
    detail: 'No tools, no reading, no changes. Just the model.',
    mode: 'ask',
    trust: 'ask',
    glyph: ICON('M3 4.4a1.6 1.6 0 011.6-1.6h6.8A1.6 1.6 0 0113 4.4v4.4a1.6 1.6 0 01-1.6 1.6H6.8L3 13V4.4z'),
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
  /* keys work only while this menu holds the focus — a listener on the window
     is a listener on the whole app, and typing "2" in the composer must not
     change your permission mode */
  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      const el = document.activeElement
      if (!el || !el.closest('[data-mode-menu]')) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
        return
      }
      const n = Number(ev.key)
      if (n >= 1 && n <= CHOICES.length) {
        const c = CHOICES[n - 1]
        if (c) {
          ev.preventDefault()
          onPick(c.mode, c.trust)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onPick])

  if (!open) return null

  const isCurrent = (c: Choice) => c.mode === mode && c.trust === trust

  return (
    <div className="fixed inset-0 z-[75]" onMouseDown={onClose}>
      <motion.div
        data-mode-menu
        tabIndex={-1}
        ref={(el) => el?.focus()}
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: t.base, ease: e.out }}
        className="absolute w-[330px] overflow-hidden rounded-[12px] p-[5px] outline-none"
        style={{
          left: Math.max(12, Math.min(anchor?.x ?? 200, window.innerWidth - 330 - 12)),
          bottom: anchor ? Math.max(12, window.innerHeight - anchor.y + 8) : 120,
          background: 'var(--overlay)',
          border: '1px solid var(--line-3)',
          boxShadow: 'var(--shadow-3)',
        }}
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <p
          className="mono m-0 px-[9px] pt-[5px] pb-[6px] t-tiny tracking-[0.14em] uppercase"
          style={{ color: 'var(--text-4)' }}
        >
          Permissions
        </p>

        {CHOICES.map((c) => {
          const current = isCurrent(c)
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                onPick(c.mode, c.trust)
                onClose()
              }}
              className="ctl flex w-full items-start gap-[10px] rounded-[8px] px-[9px] py-[8px] text-left"
              style={{
                background: current ? 'var(--selected)' : 'transparent',
                color: current ? 'var(--text-1)' : 'var(--text-2)',
              }}
            >
              <span
                className="mt-[1px] shrink-0"
                style={{ color: current ? 'var(--amber)' : 'var(--text-3)' }}
              >
                {c.glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-[6px]">
                  <span className="t-small" style={{ color: current ? 'var(--text-1)' : 'var(--text-2)' }}>
                    {c.label}
                  </span>
                  {current && (
                    <span className="t-tiny" style={{ color: 'var(--amber)' }}>
                      current
                    </span>
                  )}
                </span>
                <span className="block t-tiny leading-[1.5]" style={{ color: 'var(--text-3)' }}>
                  {c.detail}
                </span>
              </span>
            </button>
          )
        })}
      </motion.div>
    </div>
  )
}
