import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Session } from '../lib/contract'
import { dur, easeOut, enterRow, spring } from '../motion/tokens'
import { IconPencil, IconPin } from './Icons'

/* ---------------------------------------------------------------------------
   The saved threads drawer.

   It lives against the right bezel and is revealed by the pointer, not by a
   button. Two affordances make that discoverable without a permanent column:
   a hairline grip that fades in the moment the pointer enters the hot zone,
   and a pin for people who would rather it stayed.
   --------------------------------------------------------------------------- */

interface ThreadDrawerProps {
  open: boolean
  pinned: boolean
  onTogglePin: () => void
  /** the artifacts tab's content — omitted means no tab */
  artifacts?: React.ReactNode
  /** how many artifacts there are, for the tab's count */
  artifactCount?: number
  /** the agents workbench tab's content — omitted means no tab */
  agents?: React.ReactNode
  /** how many runs there are, for the tab's count */
  agentCount?: number
  /** the repository review tab's content — omitted means no tab */
  review?: React.ReactNode
}

export function ThreadDrawer({
  open,
  pinned,
  onTogglePin,
  artifacts,
  artifactCount = 0,
  agents,
  agentCount = 0,
  review,
}: ThreadDrawerProps) {
  /* threads live in the sidebar now — this drawer is only what a thread produces */
  const [tab, setTab] = useState<'artifacts' | 'agents' | 'review'>('artifacts')
  const tabs: { id: 'artifacts' | 'agents' | 'review'; label: string }[] = []
  if (artifacts) tabs.push({ id: 'artifacts', label: 'Outputs' })
  if (agents) tabs.push({ id: 'agents', label: 'Agents' })
  if (review) tabs.push({ id: 'review', label: 'Review' })

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="absolute inset-y-0 right-0 z-40"
            style={{
              width: 'calc(var(--drawer-w) + 40px)',
              background:
                'linear-gradient(to right, transparent, var(--scrim))',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur.panel, ease: easeOut }}
          />
          <motion.aside
            key="panel"
            className="absolute inset-y-0 right-0 z-50 flex flex-col"
            style={{
              width: 'var(--drawer-w)',
              background: 'var(--canvas)',
              borderLeft: '1px solid var(--line-3)',
            }}
            initial={{ x: 22, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 22, opacity: 0 }}
            transition={spring.drawer}
          >
            <header className="flex items-center justify-between px-[14px] pt-[13px] pb-[8px]">
              <div className="flex items-baseline gap-[8px]">
                <h2 className="text-[13px]" style={{ color: 'var(--text-1)' }}>
                  {tab === 'artifacts' ? 'Artifacts' : tab === 'agents' ? 'Agents' : 'Review'}
                </h2>
                <span
                  className="mono text-[11px]"
                  style={{ color: 'var(--text-4)' }}
                >
                  {tab === 'artifacts' ? artifactCount : tab === 'agents' ? agentCount : ''}
                </span>
              </div>
              <div className="flex items-center gap-[6px]">
                {tabs.length > 1 && (
                  <div className="flex items-center gap-[2px]">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="ctl rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
                        style={{
                          color: tab === t.id ? 'var(--text-1)' : 'var(--text-4)',
                          border: `1px solid ${tab === t.id ? 'var(--line-3)' : 'transparent'}`,
                          background: tab === t.id ? 'var(--surface)' : 'transparent',
                        }}
                        onClick={() => setTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                type="button"
                className="ctl grid h-[26px] w-[26px] place-items-center rounded-[6px]"
                style={{
                  color: pinned ? 'var(--text-1)' : 'var(--text-4)',
                  border: `1px solid ${pinned ? 'var(--line-3)' : 'transparent'}`,
                }}
                onClick={onTogglePin}
                title={pinned ? 'Stop pinning' : 'Keep this open'}
              >
                <IconPin size={13} />
              </button>
              </div>
            </header>

            <div className="rule-engraved mx-[14px]" />

            <div className="min-h-0 flex-1 overflow-y-auto px-[8px] py-[8px]">
              {tab === 'artifacts' && artifacts
                ? artifacts
                : tab === 'agents' && agents
                  ? agents
                  : tab === 'review' && review
                    ? review
                    : null}
            </div>

            <footer
              className="px-[14px] py-[10px]"
              style={{ borderTop: '1px solid var(--line-1)' }}
            >
              <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
                Move the pointer to the right edge to reveal · ⌘B to pin
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

export function Row({
  session,
  active,
  running,
  index,
  onSelect,
  onRename,
  onDelete,
}: {
  session: Session
  active: boolean
  running: boolean
  index: number
  onSelect: (s: Session) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  /* Escape must not be undone by the blur that follows it */
  const cancelled = useRef(false)

  /* the title is fully selected when the field opens, so a rename is one keystroke */
  useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editing])

  const begin = () => {
    setDraft(session.title)
    cancelled.current = false
    setEditing(true)
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    const next = draft.trim()
    setEditing(false)
    if (next && next !== session.title) onRename(session.id, next)
  }

  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={session.title}
      className="ctl relative block w-full cursor-pointer rounded-[7px] px-[9px] py-[7px] text-left outline-none"
      initial={enterRow.initial}
      animate={enterRow.animate}
      transition={{
        duration: dur.enter,
        ease: easeOut,
        delay: Math.min(index * 0.02, 0.16),
      }}
      style={{ background: hover ? 'var(--surface)' : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (!editing) onSelect(session)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        begin()
      }}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(session)
        } else if (e.key === 'F2') {
          e.preventDefault()
          begin()
        }
      }}
    >
      {active && (
        <motion.span
          layoutId="drawer-active"
          className="absolute top-[9px] bottom-[9px] left-0 w-[2px] rounded-full"
          style={{ background: 'var(--line-5)' }}
          transition={spring.settle}
        />
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelled.current = true
              inputRef.current?.blur()
            }
          }}
          onBlur={commit}
          className="block w-full rounded-[4px] px-[3px] py-[1px] text-[12.5px] outline-none"
          style={{
            color: 'var(--text-1)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--line-4)',
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-[8px]">
            <span className="flex min-w-0 items-center gap-[6px]">
              {running && (
                <motion.span
                  className="h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ background: 'var(--text-1)' }}
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <span
                className="truncate text-[12.5px]"
                style={{ color: active ? 'var(--text-1)' : 'var(--text-2)' }}
              >
                {session.title}
              </span>
            </span>
            {hover ? (
              <span className="flex shrink-0 items-center gap-[4px]">
                <button
                  type="button"
                  className="ctl grid h-[19px] w-[19px] place-items-center rounded-[4px]"
                  style={{
                    color: 'var(--text-2)',
                    background: 'var(--surface)',
                    border: '1px solid var(--line-2)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    begin()
                  }}
                  title="Rename this thread"
                  aria-label="Rename this thread"
                >
                  <IconPencil size={10} />
                </button>
                <button
                  type="button"
                  className="ctl grid h-[19px] w-[19px] place-items-center rounded-[4px]"
                  style={{
                    color: 'var(--text-2)',
                    background: 'var(--surface)',
                    border: '1px solid var(--line-2)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(session.id)
                  }}
                  title="Delete this thread"
                  aria-label="Delete this thread"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 4.5h10M6.5 4.5V2.9h3v1.6M4.8 4.5l.55 8h5.3l.55-8" />
                  </svg>
                </button>
              </span>
            ) : (
              <span
                className="mono shrink-0 text-[10px]"
                style={{ color: 'var(--text-4)' }}
              >
                {session.age}
              </span>
            )}
          </div>
        </>
      )}
    </motion.div>
  )
}
