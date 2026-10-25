import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { SessionRow } from '../lib/api'

/* ===========================================================================
   The command palette — Cmd/Ctrl+K.

   It searches sessions, projects and the files the agent can reach, because
   "find the thing" is one action and three sources. Results re-filter on every
   keystroke with NO transition: a filtered list that animates feels slow.
   =========================================================================== */

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  sessions: SessionRow[]
  activeId: string | null
  onOpenThread: (id: string) => void
  onNewThread: () => void
  onPickFolder: () => void
}

interface Row {
  group: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette(p: CommandPaletteProps) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  /* keep the cursor row on screen — a selected row below the fold is a
     selection the reader cannot see */
  useEffect(() => {
    const el = document.querySelector('[data-palette-cursor="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, q])

  useEffect(() => {
    if (p.open) {
      setQ('')
      setCursor(0)
      /* focus after the frame, so the scroll and the focus do not fight */
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [p.open])

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase()
    const out: Row[] = []

    out.push({ group: 'Actions', label: 'New thread', run: p.onNewThread })
    out.push({ group: 'Actions', label: 'Choose a project folder…', run: p.onPickFolder })

    const hits = p.sessions.filter((s) => !needle || s.title.toLowerCase().includes(needle))
    for (const s of hits.slice(0, needle ? 40 : 6)) {
      out.push({
        group: 'Threads',
        label: s.title,
        hint: s.id === p.activeId ? 'open now' : undefined,
        run: () => p.onOpenThread(s.id),
      })
    }

    /* projects — a session's folder is its project */
    const projects = [...new Set(p.sessions.map((s) => s.workspace).filter(Boolean))] as string[]
    const pHits = projects.filter((f) => !needle || f.toLowerCase().includes(needle))
    for (const f of pHits.slice(0, 8)) {
      const leaf = f.split(/[\\/]/).filter(Boolean).pop() ?? f
      out.push({ group: 'Projects', label: leaf, hint: f, run: p.onPickFolder })
    }

    return out
  }, [q, p.sessions, p.activeId, p.onNewThread, p.onOpenThread, p.onPickFolder])

  /* group the rows, keeping the order */
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) map.set(r.group, [...(map.get(r.group) ?? []), r])
    return [...map.entries()]
  }, [rows])

  const flat = useMemo(() => grouped.flatMap(([, rs]) => rs), [grouped])

  if (!p.open) return null

  const launch = (i: number) => {
    const row = flat[i]
    if (!row) return
    p.onClose()
    row.run()
  }

  return (
    <div
      className="absolute inset-0 z-[70] flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.32)' }}
      onMouseDown={p.onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-[16px]"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line-4)', boxShadow: 'var(--shadow-modal)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-[14px] py-[12px]" style={{ borderBottom: '1px solid var(--line-1)' }}>
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(flat.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                launch(cursor)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                p.onClose()
              }
            }}
            placeholder="Find a thread, a project, or start something…"
            aria-label="Search"
            className="w-full bg-transparent t-body outline-none"
          />
        </div>

        <div className="max-h-[336px] overflow-y-auto p-[6px]">
          {flat.length === 0 && (
            <p className="px-[9px] py-[14px] t-small" style={{ color: 'var(--text-3)' }}>
              Nothing matches that.
            </p>
          )}
          {grouped.map(([group, rs]) => (
            <section key={group} className="mb-[6px]">
              <p className="mono m-0 px-[9px] py-[4px] t-tiny tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
                {group}
              </p>
              {rs.map((r) => {
                const i = flat.indexOf(r)
                return (
                  <button
                    key={`${group}:${r.label}:${i}`}
                    type="button"
                    data-palette-cursor={i === cursor}
                    className="ctl block w-full rounded-[8px] px-[9px] py-[6px] text-left"
                    style={{ background: i === cursor ? 'var(--surface-selected)' : 'transparent' }}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => launch(i)}
                  >
                    <span className="block truncate t-small" style={{ color: 'var(--text-1)' }}>
                      {r.label}
                    </span>
                    {r.hint && (
                      <span className="mono block truncate t-tiny" style={{ color: 'var(--text-4)' }}>
                        {r.hint}
                      </span>
                    )}
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
