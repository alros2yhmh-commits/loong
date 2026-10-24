import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Row } from './ThreadDrawer'
import type { Session } from '../lib/contract'
import { dur, easeOut } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The sidebar — the whole app, on one edge.

   The layout this replaces (an icon rail plus a right-edge drawer that reveals
   itself on hover) asked the reader to remember two places. ChatGPT settled
   the question years ago: one column on the left that lists the threads and
   holds the door out. Nothing hides, nothing needs discovering.

   Threads are grouped by the project they belong to — the current folder
   first, marked — because a thread list without projects is a pile.
   --------------------------------------------------------------------------- */

const folderOf = (s: Session) =>
  s.workspace ? s.workspace.split(/[\\/]/).filter(Boolean).pop() ?? s.workspace : null

export function Sidebar({
  sessions,
  activeId,
  runningIds,
  workspace,
  open,
  onToggle,
  onNewThread,
  onNewProject,
  onSearch,
  onOpenSettings,
  soundOn,
  onToggleSound,
  onSelect,
  onRename,
  onDelete,
  onFork,
  runningAgents = 0,
}: {
  sessions: Session[]
  activeId: string | null
  runningIds: string[]
  workspace: string | null
  open: boolean
  onToggle: () => void
  onNewThread: () => void
  /** pick a folder — that folder becomes the project, and its threads appear */
  onNewProject: () => void
  onSearch: () => void
  onOpenSettings: () => void
  soundOn: boolean
  onToggleSound: () => void
  onSelect: (s: Session) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  /** copy a thread — its words and its run — under a new id */
  onFork: (id: string) => void
  /** how many child agents are working right now — visible from anywhere */
  runningAgents?: number
}) {
  /* projects fold. A workspace with forty threads is a wall otherwise. */
  const [folded, setFolded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const current = workspace ? folderOf({ workspace } as Session) : null
    const visible = sessions
    const map = new Map<string | null, Session[]>()
    for (const s of visible) {
      const key = folderOf(s)
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === current) return -1
      if (b === current) return 1
      return (a ?? 'zzz').localeCompare(b ?? 'zzz')
    })
  }, [sessions, workspace])

  const fold = (project: string | null) => {
    const key = project ?? 'none'
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!open) {
    /* collapsed: a single rail-shaped grip that opens it, nothing else */
    return (
      <div
        className="flex h-full w-[52px] shrink-0 flex-col items-center gap-[10px] pt-[12px]"
        style={{ borderLeft: '1px solid var(--line-1)' }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="ctl grid h-[30px] w-[30px] place-items-center rounded-[7px]"
          style={{ border: '1px solid var(--line-2)' }}
          title="Open the sidebar"
          aria-label="Open the sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 3h12M2 8h12M2 13h12" stroke="var(--text-2)" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onNewThread}
          className="ctl grid h-[30px] w-[30px] place-items-center rounded-[7px]"
          style={{ border: '1px solid var(--line-2)' }}
          title="New thread"
          aria-label="New thread"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="var(--text-2)" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <motion.aside
      initial={{ x: -8, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: dur.panel, ease: easeOut }}
      className="flex h-full w-[248px] shrink-0 flex-col"
      style={{ borderLeft: '1px solid var(--line-1)', background: 'var(--canvas)' }}
    >
      {/* the head is a label, not a logo: the workspace is what this column is
          about, and the mark already lives in the window title */}
      <div className="flex items-center gap-[8px] px-[14px] pt-[14px] pb-[4px]">
        <span
          className="mono flex-1 text-[10px] tracking-[0.14em] uppercase"
          style={{ color: 'var(--text-4)' }}
        >
          Workspace
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="ctl grid h-[22px] w-[22px] place-items-center rounded-[6px]"
          style={{ color: 'var(--text-4)' }}
          title="Close the sidebar"
          aria-label="Close the sidebar"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Home: a fresh thread, the way a workspace starts */}
      <button
        type="button"
        onClick={onNewThread}
        className="ctl mx-[8px] flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left"
        style={{ color: 'var(--text-2)' }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M2.5 7.2L8 2.5l5.5 4.7V13a.5.5 0 01-.5.5h-3V9.5h-4v4h-3a.5.5 0 01-.5-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[12.5px]">Home</span>
      </button>

      {/* Projects: the label above the folders. A workspace is a set of
          folders, and a folder is a set of threads. */}
      <div className="mt-[10px] flex items-center gap-[8px] px-[14px] pb-[4px]">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="var(--text-4)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="mono flex-1 text-[10px] tracking-[0.14em] uppercase" style={{ color: 'var(--text-4)' }}>
          Projects
        </span>
        <button
          type="button"
          onClick={onNewProject}
          className="ctl grid h-[20px] w-[20px] place-items-center rounded-[5px]"
          style={{ color: 'var(--text-3)' }}
          title="New project — pick a folder"
          aria-label="New project"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onSearch}
          className="ctl grid h-[20px] w-[20px] place-items-center rounded-[5px]"
          style={{ color: 'var(--text-3)' }}
          title="Search threads (Ctrl+K)"
          aria-label="Search threads"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.2 10.2L13.5 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* the threads, by project */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[8px]">
        {groups.length === 0 && (
          <p className="px-[8px] py-[10px] text-[12px]" style={{ color: 'var(--text-4)' }}>
            {sessions.length === 0 ? 'No threads yet.' : 'Nothing matches.'}
          </p>
        )}
        {groups.map(([project, rows]) => (
          <div key={project ?? 'none'} className="mb-[6px]">
            <button
              type="button"
              onClick={() => fold(project)}
              className="ctl flex w-full items-center gap-[5px] rounded-[5px] px-[8px] pb-[3px] pt-[7px] text-left"
              aria-expanded={!folded.has(project ?? 'none')}
            >
              <motion.span
                animate={{ rotate: folded.has(project ?? 'none') ? -90 : 0 }}
                transition={{ duration: 0.12 }}
                className="block"
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M4 6l4 4 4-4" stroke="var(--text-4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.span>
              <span
                className="mono text-[10px] tracking-[0.08em] uppercase"
                style={{ color: 'var(--text-4)' }}
              >
                {project ?? 'no project'} · {rows.length}
              </span>
            </button>
            {!folded.has(project ?? 'none') &&
            rows.map((s, i) => (
              <Row
                key={s.id}
                session={s}
                active={s.id === activeId}
                running={runningIds.includes(s.id)}
                index={i}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                onFork={onFork}
              />
            ))}
          </div>
        ))}
      </div>

      {/* work happening in the background must be visible from here, not only
          in the thread it belongs to */}
      {runningAgents > 0 && (
        <div
          className="mx-[10px] mb-[6px] flex items-center gap-[7px] rounded-[7px] px-[9px] py-[5px]"
          style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
        >
          <motion.span
            className="block h-[5px] w-[5px] rounded-full"
            style={{ background: 'var(--text-2)' }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="mono text-[10.5px]" style={{ color: 'var(--text-3)' }}>
            {runningAgents} {runningAgents === 1 ? 'agent' : 'agents'} working
          </span>
        </div>
      )}

      {/* the way out: memory and settings, at the bottom where the eye
          lands when it leaves the list */}
      <footer className="mt-auto flex flex-col gap-[2px] px-[8px] py-[9px]" style={{ borderTop: '1px solid var(--line-1)' }}>
        <button
          type="button"
          onClick={onOpenSettings}
          className="ctl flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left text-[12.5px]"
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
          onClick={onToggleSound}
          className="ctl flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left text-[12.5px]"
          style={{ color: 'var(--text-2)' }}
          title={soundOn ? 'Sound on' : 'Sound off'}
          aria-label={soundOn ? 'Sound on' : 'Sound off'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 6.2v3.6h2.2L8.4 12V4L5.2 6.2H3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            {soundOn && <path d="M10.4 5.6a3.4 3.4 0 010 4.8M12.2 3.8a6 6 0 010 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
          </svg>
          Sound
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="ctl flex items-center gap-[9px] rounded-[8px] px-[10px] py-[6px] text-left text-[12.5px]"
          style={{ color: 'var(--text-2)' }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1L3.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Settings
        </button>
      </footer>
    </motion.aside>
  )
}
