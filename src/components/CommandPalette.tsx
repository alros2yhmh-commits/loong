import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dur, easeOut, spring } from '../motion/tokens'
import { sound } from '../lib/sound'
import type { Session } from '../lib/contract'

/* ---------------------------------------------------------------------------
   The command palette.

   Every action in Loong is reachable without the pointer, and so is every
   saved thread — this is the app's search, not a shortcut list. Typing filters
   commands and thread titles together, because "where did I ask about the
   drawer" and "open settings" are the same gesture to the person typing.
   --------------------------------------------------------------------------- */

export interface Command {
  id: string
  label: string
  group: string
  hint?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: Command[]
  /** saved threads, searchable by title */
  threads: Session[]
  onOpenThread: (id: string) => void
}

type Row =
  | { kind: 'cmd'; id: string; group: string; label: string; hint?: string; run: () => void }
  | { kind: 'thread'; id: string; group: string; label: string; hint?: string; run: () => void }

/** how many threads to show before the reader types anything */
const IDLE_THREADS = 6
const MAX_THREAD_HITS = 20

export function CommandPalette({
  open,
  onClose,
  commands,
  threads,
  onOpenThread,
}: CommandPaletteProps) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase()

    const cmdRows: Row[] = (
      needle
        ? commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(needle))
        : commands
    ).map((c) => ({
      kind: 'cmd',
      id: c.id,
      group: c.group,
      label: c.label,
      hint: c.hint,
      run: c.run,
    }))

    /* the palette's first job is ACTING. A model list at the top of it buries
       "new thread" under six vendor names. Groups are ordered by what they are
       for: the work, then the view, then the model. */
    const groupRank = (g: string): number => {
      const key = g.toLowerCase()
      if (key.includes('thread')) return 0
      if (key.includes('navigate') || key.includes('layout')) return 1
      if (key.includes('router') || key.includes('model')) return 9
      return 5
    }
    cmdRows.sort((a, b) => groupRank(a.group) - groupRank(b.group))

    const hits = needle
      ? threads.filter((s) => s.title.toLowerCase().includes(needle))
      : threads
    const threadRows: Row[] = hits.slice(0, needle ? MAX_THREAD_HITS : IDLE_THREADS).map(
      (s) => ({
        kind: 'thread',
        id: `thread-${s.id}`,
        group: 'Saved threads',
        label: s.title,
        hint: s.age,
        run: () => onOpenThread(s.id),
      }),
    )

    /* when someone is searching, the thing they are searching for belongs
       above the fixed list of actions */
    return needle && threadRows.length > 0
      ? [...threadRows, ...cmdRows]
      : [...cmdRows, ...threadRows]
  }, [q, commands, threads, onOpenThread])

  useEffect(() => {
    if (open) {
      setQ('')
      setCursor(0)
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, rows.length - 1))
        sound.play('click')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
        sound.play('click')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const row = rows[cursor]
        if (row) {
          sound.play('select')
          row.run()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, rows, cursor, onClose])

  let lastGroup = ''

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[60] flex items-start justify-center pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.enter, ease: easeOut }}
          style={{ background: 'var(--scrim)' }}
          onMouseDown={onClose}
        >
          <motion.div
            className="w-[540px] overflow-hidden rounded-[12px]"
            style={{
              background: 'var(--canvas)',
              border: '1px solid var(--line-4)',
            }}
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={spring.drawer}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-[10px] px-[13px] py-[11px]">
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setCursor(0)
                }}
                placeholder="Search commands and saved threads…"
                className="w-full bg-transparent text-[13.5px] outline-none"
                style={{ color: 'var(--text-1)' }}
              />
              <span
                className="mono shrink-0 rounded-[4px] px-[5px] py-[2px] text-[10px]"
                style={{
                  border: '1px solid var(--line-2)',
                  color: 'var(--text-4)',
                }}
              >
                esc
              </span>
            </div>

            <div className="rule-engraved" />

            <div className="max-h-[336px] overflow-y-auto p-[6px]">
              {rows.length === 0 && (
                <p
                  className="px-[9px] py-[14px] text-[12.5px]"
                  style={{ color: 'var(--text-4)' }}
                >
                  Nothing matches that.
                </p>
              )}
              {rows.map((row, i) => {
                const header = row.group !== lastGroup ? row.group : null
                lastGroup = row.group
                return (
                  <div key={row.id}>
                    {header && (
                      <p
                        className="px-[9px] pt-[8px] pb-[5px] text-[10px] tracking-[0.09em] uppercase"
                        style={{ color: 'var(--text-4)' }}
                      >
                        {header}
                      </p>
                    )}
                    <button
                      type="button"
                      className="ctl relative flex w-full items-center justify-between rounded-[7px] px-[9px] py-[7px] text-left"
                      style={{
                        background: i === cursor ? 'var(--surface)' : 'transparent',
                      }}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => {
                        sound.play('select')
                        row.run()
                        onClose()
                      }}
                    >
                      {i === cursor && (
                        <motion.span
                          layoutId="palette-cursor"
                          className="absolute top-[8px] bottom-[8px] left-0 w-[2px] rounded-full"
                          style={{ background: 'var(--line-5)' }}
                          transition={spring.settle}
                        />
                      )}
                      <span
                        className="truncate text-[12.5px]"
                        style={{
                          color:
                            i === cursor ? 'var(--text-1)' : 'var(--text-2)',
                        }}
                      >
                        {row.label}
                      </span>
                      {row.hint && (
                        <span
                          className="mono ml-[10px] shrink-0 text-[10.5px]"
                          style={{ color: 'var(--text-4)' }}
                        >
                          {row.hint}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
