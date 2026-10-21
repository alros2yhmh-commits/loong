import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { AgentSummary } from '../lib/useAgentStream'
import { dur, easeOut, enterRow, spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The agents workbench.

   Every thread that has run in this session, in one list — running, waiting
   on a human, and just finished — with what each is doing right now, how long
   it has been at it, and a stop button for the ones still going. This is the
   screen the top three competitors all grew in 2026 (Cursor's fleet, Codex's
   parallel-task workbench, Claude Code's background agents) and the thing a
   multi-threaded agent app owes you: a run is a thing you can watch, not a
   thing you have to guess at.

   Monochrome and hairline like the rest of Loong — the timers and the step
   text do the informing; nothing is colour-coded.
   --------------------------------------------------------------------------- */

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

function elapsed(start?: number, end?: number, now = Date.now()): string {
  if (!start) return ''
  const s = Math.max(0, Math.round(((end ?? now) - start) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

export function AgentsPanel({
  agents,
  activeId,
  onOpen,
  onStop,
}: {
  agents: AgentSummary[]
  activeId: string
  onOpen: (id: string) => void
  onStop: (id: string) => void
}) {
  const anyRunning = agents.some((a) => a.running)
  const now = useNow(anyRunning)

  if (agents.length === 0) {
    return (
      <p className="m-0 px-[9px] py-[10px] text-[11.5px] leading-[1.6]" style={{ color: 'var(--text-4)' }}>
        Nothing running yet. Every thread you start lands here — live progress, how
        long it has been working, and a stop control — so parallel work is something
        you can watch, not guess at.
      </p>
    )
  }

  const running = agents.filter((a) => a.running)
  const rest = agents.filter((a) => !a.running)

  return (
    <div className="flex flex-col">
      {running.length > 0 && (
        <>
          <GroupLabel>Running · {running.length}</GroupLabel>
          {running.map((a, i) => (
            <Row key={a.id} a={a} active={a.id === activeId} now={now} index={i} onOpen={onOpen} onStop={onStop} />
          ))}
        </>
      )}
      {rest.length > 0 && (
        <>
          <GroupLabel>{running.length > 0 ? 'Finished' : 'Recent'}</GroupLabel>
          {rest.map((a, i) => (
            <Row key={a.id} a={a} active={a.id === activeId} now={now} index={i + running.length} onOpen={onOpen} onStop={onStop} />
          ))}
        </>
      )}
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-[9px] pt-[6px] pb-[5px] text-[10px] tracking-[0.09em] uppercase" style={{ color: 'var(--text-4)' }}>
      {children}
    </p>
  )
}

function Row({
  a,
  active,
  now,
  index,
  onOpen,
  onStop,
}: {
  a: AgentSummary
  active: boolean
  now: number
  index: number
  onOpen: (id: string) => void
  onStop: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={a.goal}
      className="ctl relative block w-full cursor-pointer rounded-[7px] px-[9px] py-[8px] text-left outline-none"
      initial={enterRow.initial}
      animate={enterRow.animate}
      transition={{ duration: dur.enter, ease: easeOut, delay: Math.min(index * 0.02, 0.16) }}
      style={{
        background: hover ? 'var(--surface)' : 'transparent',
        border: '1px solid var(--line-2)',
        marginBottom: 6,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(a.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(a.id)
        }
      }}
    >
      {active && (
        <motion.span
          layoutId="agents-active"
          className="absolute top-[9px] bottom-[9px] left-0 w-[2px] rounded-full"
          style={{ background: 'var(--line-5)' }}
          transition={spring.settle}
        />
      )}
      <div className="flex items-center gap-[7px]">
        {a.running ? (
          <motion.span
            className="h-[5px] w-[5px] shrink-0 rounded-full"
            style={{ background: 'var(--text-1)' }}
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ border: '1px solid var(--line-4)' }} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: a.running ? 'var(--text-1)' : 'var(--text-2)' }}>
          {a.goal}
        </span>
        {a.waiting && (
          <span
            className="mono shrink-0 rounded-[4px] px-[5px] py-[1px] text-[9.5px]"
            style={{ border: '1px solid var(--line-4)', color: 'var(--text-2)' }}
          >
            needs you
          </span>
        )}
        {a.running && (
          <button
            type="button"
            className="ctl shrink-0 rounded-[4px] px-[6px] py-[1px] text-[10px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={(e) => {
              e.stopPropagation()
              onStop(a.id)
            }}
            title="Stop this run"
          >
            stop
          </button>
        )}
      </div>
      <div className="mono mt-[4px] flex items-center gap-[8px] text-[10.5px]" style={{ color: 'var(--text-4)' }}>
        <span className="min-w-0 truncate">{a.detail}</span>
        {a.tools > 0 && (
          <span className="shrink-0">
            · {a.tools} tool{a.tools === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {a.running
            ? `worked ${elapsed(a.startedAt, undefined, now)}`
            : a.endedAt
              ? `took ${elapsed(a.startedAt, a.endedAt)}`
              : ''}
        </span>
      </div>
    </motion.div>
  )
}
