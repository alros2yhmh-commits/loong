import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Plan } from '../lib/contract'
import { dur, easeOut, spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The run bar.

   A chat window is the right place to say what you want and the wrong place
   to see what is happening: half an hour into a run, the goal is scrolled
   off the top and the plan is buried under forty tool cards. So the goal, the
   plan, the clock and the context budget live in one hairline that never
   moves — the four things a person checks when they look up.
   --------------------------------------------------------------------------- */

const STEP_MARK: Record<string, string> = {
  pending: '·',
  in_progress: '·',
  done: '✓',
  blocked: '×',
}

function elapsed(from: number | null, now: number): string {
  if (!from) return '—'
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

interface RunBarProps {
  /** what the reader asked for — the message that started this run */
  goal: string
  plan: Plan | null
  running: boolean
  /** when the current run started, or null when idle */
  startedAt: number | null
  /** characters of conversation history, and the compaction budget */
  historyChars: number
  budgetChars: number
  /** what the last run cost, when the model's price is known */
  cost: string | null
  /** a run that changed files can be undone, as a unit */
  onRewind: () => void
  canRewind: boolean
  /** the trust level this run is using — full trust is stated, not implied */
  trust?: 'ask' | 'auto'
}

export function RunBar({
  goal,
  plan,
  running,
  startedAt,
  historyChars,
  budgetChars,
  cost,
  onRewind,
  canRewind,
  trust = 'ask',
}: RunBarProps) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    timer.current = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [running])

  const steps = plan?.steps ?? []
  const done = steps.filter((s) => s.status === 'done').length
  const current = steps.find((s) => s.status === 'in_progress')?.description
  const ctxPercent = Math.min(100, Math.round((historyChars / budgetChars) * 100))
  /* a rough token estimate (≈4 chars/token) so the drain is visible *before*
     the run ends and the model reports the real count — the live guard the
     earlier audits asked for */
  const estTokens = Math.round(historyChars / 4)

  return (
    <div
      className="mx-auto w-full shrink-0"
      style={{ maxWidth: 'var(--thread-measure)' }}
    >
      <div
        className="mono flex items-center gap-[10px] rounded-[7px] px-[10px] py-[5px] text-[11.5px]"
        style={{
          border: '1px solid var(--line-2)',
          background: 'var(--surface)',
          color: 'var(--text-4)',
        }}
      >
        {/* the goal, always — the thing being worked on, not its transcript */}
        <span className="min-w-0 flex-1 truncate" title={goal}>
          <span style={{ color: 'var(--text-4)' }}>goal </span>
          <span style={{ color: 'var(--text-2)' }}>{goal || '—'}</span>
        </span>

        {/* the plan: a counter that opens into the list */}
        {steps.length > 0 && (
          <button
            type="button"
            className="ctl flex shrink-0 items-center gap-[6px] rounded-[5px] px-[6px] py-[1px]"
            style={{ border: '1px solid var(--line-2)' }}
            onClick={() => setOpen((v) => !v)}
            title={plan?.task ?? ''}
          >
            <span style={{ color: 'var(--text-2)' }}>
              plan {done}/{steps.length}
            </span>
            <motion.span
              animate={{ rotate: open ? 90 : 0 }}
              transition={{ duration: dur.hover, ease: easeOut }}
              style={{ display: 'grid', placeItems: 'center' }}
            >
            </motion.span>
          </button>
        )}

        {/* the context budget: honest, live, and never a surprise at 100% */}
        <span
          className="hidden shrink-0 sm:inline"
          title={`≈${estTokens.toLocaleString()} tokens · ${historyChars.toLocaleString()} of ${budgetChars.toLocaleString()} characters of history — the oldest turns are summarised past this`}
          style={ctxPercent >= 80 ? { color: 'var(--guilloche-hot)' } : undefined}
        >
          ctx {ctxPercent}% · ≈{estTokens.toLocaleString()} tok
        </span>

        {/* what the run cost, when the price is known — "free" beats a dash */}
        {cost && (
          <span className="hidden shrink-0 sm:inline" style={{ color: 'var(--text-4)' }}>
            {cost}
          </span>
        )}

        {/* the undo for a whole run, one click, from the bar that watches it */}
        {canRewind && (
          <button
            type="button"
            className="ctl shrink-0 rounded-[5px] px-[6px] py-[1px]"
            style={{ border: '1px solid var(--line-2)' }}
            onClick={onRewind}
            title="Put every file the last run changed back the way it was"
          >
            Rewind
          </button>
        )}

        {/* the trust level of this run — stated, not implied.
            Full trust changes what the agent does; the bar that watches the
            run is the right place to say so, not a settings page. */}
        {running && trust === 'auto' && (
          <span
            className="mono shrink-0 rounded-[4px] px-[5px] py-[1px] text-[11px]"
            style={{
              border: '1px solid var(--line-3)',
              background: 'var(--surface-raised)',
              color: 'var(--text-3)',
            }}
            title="Full trust — writes and commands run without asking"
          >
            auto
          </span>
        )}

        <span className="w-[52px] shrink-0 text-right" style={{ color: running ? 'var(--text-2)' : 'var(--text-4)' }}>
          {elapsed(startedAt, now)}
        </span>
      </div>

      {/* the plan, when asked for — the same list, out of the chat's way */}
      <AnimatePresence initial={false}>
        {open && steps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring.settle}
            className="overflow-hidden"
          >
            <div
              className="mono mt-[5px] rounded-[7px] px-[11px] py-[8px] text-[11px] leading-[1.9]"
              style={{
                border: '1px solid var(--line-2)',
                background: 'var(--surface)',
              }}
            >
              {plan?.task && (
                <p className="m-0 mb-[4px]" style={{ color: 'var(--text-4)' }}>
                  {plan.task}
                </p>
              )}
              {steps.map((s, i) => (
                <div key={`${i}-${s.description}`} className="flex gap-[8px]">
                  <span
                    style={{
                      color:
                        s.status === 'done'
                          ? 'var(--text-2)'
                          : s.status === 'blocked'
                            ? 'var(--text-1)'
                            : 'var(--text-4)',
                    }}
                  >
                    {STEP_MARK[s.status]}
                  </span>
                  <span
                    style={{
                      color:
                        s.status === 'in_progress'
                          ? 'var(--text-1)'
                          : s.status === 'done'
                            ? 'var(--text-3)'
                            : 'var(--text-4)',
                      textDecoration:
                        s.status === 'done' ? 'line-through' : undefined,
                    }}
                  >
                    {s.description}
                  </span>
                </div>
              ))}
              {current && (
                <p className="m-0 mt-[4px]" style={{ color: 'var(--text-4)' }}>
                  now: {current}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
