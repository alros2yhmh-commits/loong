import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type SessionRow } from '../lib/api'
import { Mark } from './Mark'

/* ===========================================================================
   The sidebar.

   Two surfaces, and the list under them changes with the surface:

     Home — a conversation with the model. Its threads are CONVERSATIONS.
     Code — the agent, working in a folder you pick. Its threads are SESSIONS.

   There are no projects. The backend has no project entity; a session simply
   carries the folder it was started in, and inventing a grouping above it made
   the list lie about what a thread is.

   No Scheduled, no Customize, no Memory. Each was a surface with no job.

   272px, drags 240–400, double-click the grip resets. No chevrons anywhere.
   =========================================================================== */

export type Surface = 'home' | 'code'

export interface SidebarProps {
  sessions: SessionRow[]
  activeId: string | null
  runningIds: string[]
  surface: Surface
  width: number
  open: boolean
  onToggle: () => void
  onSurface: (s: Surface) => void
  onOpenThread: (id: string) => void
  onNewThread: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  onSearch: () => void
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

/** the folder's leaf name, for a session's subtitle */
const leaf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function Sidebar(p: SidebarProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null)
  /* one rename, one request: Enter commits and then blurs the field, so both
     paths fire and both used to PATCH */
  const committed = useRef(false)
  /* one rename, one request: Enter commits and then blurs the field, so both
     That is the whole difference between a conversation and a session. */
  const shown = p.sessions.filter((s) => (p.surface === 'code' ? Boolean(s.workspace) : !s.workspace))

  const commitRename = (id: string) => {
    if (committed.current) return
    committed.current = true
    const next = draft.trim()
    setRenaming(null)
    if (next) p.onRename(id, next)
    /* the guard is released on the next tick, after the blur has landed */
    setTimeout(() => {
      committed.current = false
    }, 0)
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: p.open ? p.width : 0, opacity: p.open ? 1 : 0 }}
      transition={{ duration: 0.24, ease: [0.65, 0, 0.35, 1] }}
      className="relative z-30 flex h-full shrink-0 flex-col overflow-hidden"
      style={{ background: 'var(--surface)', borderRight: '1px solid var(--line-1)' }}
      data-sidebar
    >
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

      {/* the head: the mark, the name, the search */}
      <div className="flex items-center gap-[8px] px-[14px] pt-[12px] pb-[8px]">
        <Mark size={17} />
        <span className="display flex-1 t-small" style={{ color: 'var(--text-1)' }}>
          Loong
        </span>
        <button
          type="button"
          className="ctl grid h-[24px] w-[24px] place-items-center rounded-[7px]"
          title="Search — Ctrl K"
          aria-label="Search"
          onClick={p.onSearch}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* the two surfaces */}
      <div className="flex flex-col gap-[1px] px-[8px] pb-[4px]">
        <SurfaceRow
          label="Home"
          hint="Talk to the model"
          active={p.surface === 'home'}
          onClick={() => p.onSurface('home')}
          icon={
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M2.6 7.4L8 2.8l5.4 4.6v5.2a1 1 0 01-1 1H3.6a1 1 0 01-1-1V7.4z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
        <SurfaceRow
          label="Code"
          hint="The agent, in a folder"
          active={p.surface === 'code'}
          onClick={() => p.onSurface('code')}
          icon={
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M5.6 5.2L2.8 8l2.8 2.8M10.4 5.2L13.2 8l-2.8 2.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        />
      </div>

      <div className="mx-[14px] my-[7px] rule-engraved" />

      <div className="px-[8px]">
        <button
          type="button"
          onClick={p.onNewThread}
          className="ctl flex w-full items-center gap-[9px] rounded-[8px] px-[9px] py-[6px] text-left t-small"
          style={{ color: 'var(--text-2)' }}
        >
          <span className="grid w-[14px] place-items-center" style={{ color: 'var(--text-3)' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          {p.surface === 'code' ? 'New session' : 'New chat'}
        </button>
      </div>

      {/* the list: conversations in Home, sessions in Code */}
      <motion.nav
        key={p.surface}
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[10px]"
      >
        <p className="mono m-0 px-[9px] pt-[12px] pb-[6px] t-tiny tracking-[0.12em] uppercase" style={{ color: 'var(--text-4)' }}>
          {p.surface === 'code' ? 'Sessions' : 'Conversations'}
        </p>

        {shown.length === 0 && (
          <div className="px-[9px] py-[6px]">
            <p className="m-0 t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
              {p.surface === 'code'
                ? 'No sessions yet. Pick a folder under the prompt and start one.'
                : 'No conversations yet. Ask anything.'}
            </p>
          </div>
        )}

        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {shown.map((s) => {
              const live = p.runningIds.includes(s.id)
              const active = s.id === p.activeId
              return (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-visible"
                >
                  <div
                    className="group relative flex items-center gap-[8px] rounded-[8px] px-[8px] py-[5px]"
                    style={{ background: active ? 'var(--surface-selected)' : 'transparent' }}
                  >
                    <span
                      className={`h-[6px] w-[6px] shrink-0 rounded-full ${live ? 'pulse-dot' : ''}`}
                      style={{
                        background: live ? 'var(--text-1)' : 'transparent',
                        border: live ? 'none' : '1px solid var(--line-3)',
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
                          if (e.key === 'Escape') {
                            committed.current = true
                            setRenaming(null)
                            setTimeout(() => {
                              committed.current = false
                            }, 0)
                          }
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
                        <span className="block truncate t-tiny" style={{ color: 'var(--text-4)' }}>
                          {p.surface === 'code' && s.workspace ? `${leaf(s.workspace)} · ` : ''}
                          {ago(s.updatedAt)}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="ctl grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[5px] opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Actions for ${s.title}`}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMenu(
                          menu?.id === s.id
                            ? null
                            : { id: s.id, top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 180) },
                        )
                      }}
                    >
                      <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
                        ⋯
                      </span>
                    </button>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      </motion.nav>

      {/* the footer: settings, and nothing else */}
      <div className="mt-auto px-[8px] py-[8px]" style={{ borderTop: '1px solid var(--line-1)' }}>
        <button
          type="button"
          onClick={p.onOpenSettings}
          className="ctl flex w-full items-center gap-[9px] rounded-[8px] px-[9px] py-[6px] text-left t-small"
          style={{ color: 'var(--text-2)' }}
        >
          <span className="grid w-[14px] place-items-center" style={{ color: 'var(--text-3)' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </span>
          Settings
        </button>
      </div>

      {/* the row menu, in a PORTAL — inside the scroll container it was clipped
          to nothing whenever the list was short */}
      <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-[85]" onMouseDown={() => setMenu(null)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="fixed z-[86] w-[172px] rounded-[12px] p-[4px]"
              style={{
                top: menu.top,
                left: menu.left,
                background: 'var(--canvas)',
                border: '1px solid var(--line-3)',
                boxShadow: 'var(--shadow-modal)',
              }}
            >
              {(
                [
                  [
                    'Rename',
                    () => {
                      const row = p.sessions.find((x) => x.id === menu.id)
                      setDraft(row?.title ?? '')
                      setRenaming(menu.id)
                    },
                  ],
                  [
                    'Fork',
                    () => void api.forkSession(menu.id).then(() => window.location.reload()),
                  ],
                  ['Delete', () => p.onDelete(menu.id)],
                ] as const
              ).map(([label, fn]) => (
                <button
                  key={label}
                  type="button"
                  className="ctl block w-full rounded-[8px] px-[9px] py-[6px] text-left t-small"
                  style={{ color: 'var(--text-1)' }}
                  onClick={() => {
                    setMenu(null)
                    fn()
                  }}
                >
                  {label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.aside>
  )
}

function SurfaceRow({
  label,
  hint,
  icon,
  active,
  onClick,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={hint}
      className="ctl flex items-center gap-[9px] rounded-[8px] px-[9px] py-[6px] text-left t-small"
      style={{
        color: active ? 'var(--text-1)' : 'var(--text-3)',
        background: active ? 'var(--surface-selected)' : 'transparent',
        fontWeight: active ? 500 : 400,
      }}
    >
      <span style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}>{icon}</span>
      {label}
    </button>
  )
}
