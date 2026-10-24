import { motion } from 'motion/react'
import { api, type SessionRow } from '../lib/api'

/* ===========================================================================
   The sidebar: 280px, drags 240-400, double-click the grip resets.

   The head is a label, not a logo. The folder is the project — there is no
   separate project entity in the backend, and the sidebar must not invent one.
   A session row carries a 6px state dot: filled and blinking while it runs,
   hollow when it is idle.

   No chevrons, no arrows. The fold marker is a plus or a minus, and the
   affordance is the hover state.
   =========================================================================== */

export interface SidebarProps {
  sessions: SessionRow[]
  activeId: string | null
  runningIds: string[]
  workspace: string | null
  width: number
  open: boolean
  onToggle: () => void
  onOpenThread: (id: string) => void
  onNewThread: () => void
  onNewProject: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onOpenMemory: () => void
  onOpenSettings: () => void
  onResizeStart: (e: React.PointerEvent) => void
  onResizeReset: () => void
  resizing: boolean
}

const ago = (at: number): string => {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function Sidebar(p: SidebarProps) {
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()
  const shown = p.sessions.filter(
    (s) => !needle || s.title.toLowerCase().includes(needle),
  )

  /* group by the folder the session belongs to — the project */
  /* the group label is the folder's leaf, not its whole path */
  const leaf = (p: string) => (p.split(/[\\/]/).filter(Boolean).pop() ?? p)
  const groups = (() => {
    const map = new Map<string, SessionRow[]>()
    for (const s of shown) {
      const key = s.workspace ?? 'no folder'
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === (p.workspace ?? '')) return -1
      if (b === (p.workspace ?? '')) return 1
      return a.localeCompare(b)
    })
  })()

  const commitRename = (id: string) => {
    const next = draft.trim()
    setRenaming(null)
    if (next) p.onRename(id, next)
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: p.open ? p.width : 52 }}
      transition={{ duration: 0.24, ease: [0.65, 0, 0.35, 1] }}
      className="relative z-30 flex h-full shrink-0 flex-col"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--line-1)' }}
      data-sidebar
    >
      {/* the resize grip — 4px on the edge, double-click to reset */}
      {p.open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Sidebar width"
          title="Sidebar width — drag, double-click to reset"
          onPointerDown={p.onResizeStart}
          onDoubleClick={p.onResizeReset}
          className="absolute top-0 bottom-0 right-0 z-20 w-[4px] cursor-col-resize"
          style={{ background: p.resizing ? 'var(--line-4)' : 'transparent' }}
        />
      )}

      {p.open ? (
        <>
          {/* the head is a label: the workspace is what this column is about */}
          <div className="flex items-center gap-[8px] px-[14px] pt-[14px] pb-[6px]">
            <span className="mono flex-1 t-tiny tracking-[0.14em] uppercase" style={{ color: 'var(--text-4)' }}>
              Workspace
            </span>
            <button
              type="button"
              className="ctl grid h-[22px] w-[22px] place-items-center rounded-[6px]"
              title="New project"
              aria-label="New project"
              onClick={p.onNewProject}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="ctl grid h-[22px] w-[22px] place-items-center rounded-[6px]"
              title="Search"
              aria-label="Search"
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="px-[10px] pb-[6px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a thread…"
              aria-label="Find a thread"
              className="w-full rounded-[8px] px-[9px] py-[5px] t-small outline-none"
              style={{ border: '1px solid var(--line-2)', background: 'var(--canvas)' }}
            />
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[8px]">
            {groups.length === 0 && (
              <div className="px-[10px] py-[14px]">
                <p className="m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
                  {p.sessions.length === 0
                    ? 'No threads yet. Start one and the work stays here.'
                    : 'Nothing matches.'}
                </p>
                {p.sessions.length === 0 && (
                  <button
                    type="button"
                    onClick={p.onNewThread}
                    className="ctl mt-[10px] rounded-[8px] px-[11px] py-[6px] t-small"
                    style={{ border: '1px solid var(--line-3)', color: 'var(--text-1)' }}
                  >
                    New thread
                  </button>
                )}
              </div>
            )}

            {groups.map(([project, rows]) => {
              const isFolded = folded.has(project)
              return (
                <section key={project} className="mb-[10px]">
                  <div className="flex items-center gap-[6px] px-[8px] py-[5px]">
                    <button
                      type="button"
                      className="ctl grid h-[16px] w-[16px] place-items-center rounded-[4px]"
                      aria-label={isFolded ? `Expand ${project}` : `Collapse ${project}`}
                      aria-expanded={!isFolded}
                      onClick={() =>
                        setFolded((prev) => {
                          const next = new Set(prev)
                          if (next.has(project)) next.delete(project)
                          else next.add(project)
                          return next
                        })
                      }
                    >
                      <span className="mono t-tiny" style={{ color: 'var(--text-4)' }}>
                        {isFolded ? '+' : '−'}
                      </span>
                    </button>
                    <span className="min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-2)' }} title={project}>
                      {project === 'no folder' ? project : leaf(project)}
                    </span>
                    <span className="t-tiny" style={{ color: 'var(--text-4)' }}>
                      {rows.length}
                    </span>
                  </div>

                  {!isFolded && (
                    <ul className="m-0 list-none p-0">
                      {rows.map((s) => {
                        const live = p.runningIds.includes(s.id)
                        return (
                          <li key={s.id}>
                            <div
                              className="group relative flex items-center gap-[8px] rounded-[8px] px-[10px] py-[6px]"
                              style={{
                                background: s.id === p.activeId ? 'var(--surface-selected)' : 'transparent',
                              }}
                            >
                              {/* the state dot: filled and blinking while it runs */}
                              <span
                                className="h-[6px] w-[6px] shrink-0 rounded-full"
                                style={{
                                  background: live ? 'var(--text-1)' : 'transparent',
                                  border: live ? 'none' : '1px solid var(--line-3)',
                                  animation: live ? 'pulse 1.5s ease-in-out infinite' : 'none',
                                }}
                              />
                              {renaming === s.id ? (
                                <input
                                  autoFocus
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onBlur={() => commitRename(s.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      commitRename(s.id)
                                    }
                                    if (e.key === 'Escape') setRenaming(null)
                                  }}
                                  className="min-w-0 flex-1 rounded-[4px] px-[4px] py-[1px] t-small outline-none"
                                  style={{ border: '1px solid var(--line-3)' }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => p.onOpenThread(s.id)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <span className="block truncate t-small" style={{ color: 'var(--text-1)' }}>
                                    {s.title}
                                  </span>
                                  <span className="block t-tiny" style={{ color: 'var(--text-4)' }}>
                                    {ago(s.updatedAt)}
                                  </span>
                                </button>
                              )}

                              <button
                                type="button"
                                className="ctl grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[5px] opacity-0 transition-opacity group-hover:opacity-100"
                                aria-label={`Thread actions for ${s.title}`}
                                onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}
                              >
                                <span className="t-tiny" style={{ color: 'var(--text-3)' }}>⋯</span>
                              </button>

                              {menuFor === s.id && (
                                <div
                                  className="absolute top-[26px] right-[6px] z-40 w-[168px] rounded-[12px] p-[4px]"
                                  style={{
                                    background: 'var(--canvas)',
                                    border: '1px solid var(--line-2)',
                                    boxShadow: 'var(--shadow-overlay)',
                                  }}
                                >
                                  {[
                                    ['Rename', () => {
                                      setDraft(s.title)
                                      setRenaming(s.id)
                                    }],
                                    ['Fork', () => void api.forkSession(s.id).then(() => window.location.reload())],
                                    ['Delete', () => p.onDelete(s.id)],
                                  ].map(([label, fn]) => (
                                    <button
                                      key={label as string}
                                      type="button"
                                      className="ctl block w-full rounded-[8px] px-[9px] py-[6px] text-left t-small"
                                      onClick={() => {
                                        setMenuFor(null)
                                        ;(fn as () => void)()
                                      }}
                                    >
                                      {label as string}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </nav>

          {/* the footer: memory and settings. Sound lives in Settings — a second
              control is a second place to disagree. */}
          <div className="mt-auto flex flex-col gap-[2px] px-[10px] py-[10px]" style={{ borderTop: '1px solid var(--line-1)' }}>
            <button
              type="button"
              onClick={p.onOpenMemory}
              className="ctl flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left t-small"
              style={{ color: 'var(--text-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2.5 4.2A6.5 6.5 0 0112 5.4M13.5 11.8A6.5 6.5 0 014 10.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              Memory
            </button>
            <button
              type="button"
              onClick={p.onOpenSettings}
              className="ctl flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left t-small"
              style={{ color: 'var(--text-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Settings
            </button>
          </div>
        </>
      ) : (
        /* the collapsed rail */
        <div className="flex flex-col items-center gap-[8px] pt-[10px]">
          <button
            type="button"
            className="ctl grid h-[30px] w-[30px] place-items-center rounded-[8px]"
            title="Show the sidebar"
            aria-label="Show the sidebar"
            onClick={p.onToggle}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M6.5 3v10" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            type="button"
            className="ctl grid h-[30px] w-[30px] place-items-center rounded-[8px]"
            title="New thread"
            aria-label="New thread"
            onClick={p.onNewThread}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </motion.aside>
  )
}

import { useState } from 'react'
