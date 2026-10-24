import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { Plan } from '../lib/contract'
import { dur, easeOut, spring } from '../motion/tokens'
import { enterBlock } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The plan.

   One checklist, always in the same place, always the newest version. The
   agent removes and re-adds the whole list every time it changes, which means
   this component's only job is to render it and animate the step that moved —
   no diffing, no local copy that can disagree with the runtime.

   The progress is measured, not narrated: "3 of 7 done", computed from the
   steps the model marked. A plan with no measure is a mood board.
   --------------------------------------------------------------------------- */

interface PlanBlockProps {
  plan: Plan
}

const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  done: 3,
}

export function PlanBlock({ plan }: PlanBlockProps) {
  const done = plan.steps.filter((s) => s.status === 'done').length
  const total = plan.steps.length
  const blocked = plan.steps.filter((s) => s.status === 'blocked').length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const [open, setOpen] = useState(true)

  /* the step that is running is the one worth watching, so it floats up under
     a stable order: in progress, then pending, then blocked, then done */
  const ordered = [...plan.steps].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9),
  )

  return (
    <motion.div {...enterBlock}>
      <div
        className="rounded-[9px] px-[13px] py-[11px]"
        style={{
          border: '1px solid var(--line-2)',
          background: 'var(--canvas)',
        }}
      >
        <button
          type="button"
          className="ctl flex w-full items-baseline justify-between gap-[10px] text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="Show or hide the plan"
        >
          {/* min-w-0 on the text side: a long "3 blocked" label used to push the
              chevron 5px past the row and clip it */}
          <span className="flex min-w-0 items-baseline gap-[8px]">
            <span className="text-[10px] tracking-[0.1em] uppercase" style={{ color: 'var(--text-4)' }}>
              Plan
            </span>
            <span className="mono truncate text-[10.5px]" style={{ color: 'var(--text-4)' }}>
              {done}/{total} done{blocked > 0 ? ` · ${blocked} blocked` : ''}
            </span>
          </span>
          <motion.span
            className="mono text-[11px]"
            style={{ color: 'var(--text-4)' }}
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: dur.hover, ease: easeOut }}
          >
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: dur.panel, ease: easeOut }}
              style={{ overflow: 'hidden' }}
            >
              <p
                dir="auto"
                className="bidi display m-0 mt-[8px] text-[12.5px]"
                style={{ color: 'var(--text-1)' }}
              >
                {plan.task}
              </p>

              {plan.reference && (
                <p
                  dir="auto"
                  className="bidi mono m-0 mt-[4px] text-[10.5px] leading-[1.5]"
                  style={{ color: 'var(--text-4)' }}
                >
                  reference · {plan.reference}
                </p>
              )}

              {plan.doneWhen && plan.doneWhen.length > 0 && (
                <ul className="m-0 mt-[6px] flex list-none flex-col gap-[2px] p-0">
                  {plan.doneWhen.map((criterion, i) => (
                    <li
                      key={`${i}-${criterion}`}
                      dir="auto"
                      className="bidi mono text-[10.5px] leading-[1.55]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      ○ {criterion}
                    </li>
                  ))}
                </ul>
              )}

              <div
                className="mt-[9px] mb-[10px] h-[2px] w-full overflow-hidden rounded-full"
                style={{ background: 'var(--line-2)' }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'var(--line-5)' }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={spring.settle}
                />
              </div>

              <ol className="m-0 flex list-none flex-col gap-[5px] p-0">
                {ordered.map((step, i) => (
                  <Step key={`${step.description}-${i}`} step={step} index={i} />
                ))}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function Step({
  step,
  index,
}: {
  step: Plan['steps'][number]
  index: number
}) {
  const isDone = step.status === 'done'
  const isRunning = step.status === 'in_progress'
  const isBlocked = step.status === 'blocked'
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 10)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <motion.li
      className="flex items-baseline gap-[9px] py-[2px]"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: mounted ? 1 : 0, x: mounted ? 0 : -4 }}
      transition={{
        duration: dur.enter,
        ease: easeOut,
        delay: Math.min(index * 0.015, 0.12),
      }}
    >
      {/* the marker is the state, so it works in one colour and in one shape
          vocabulary: a filled dot for done, a hollow one for now, a hatch for
          stuck */}
      <span
        aria-hidden
        className="mt-[6px] inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{
          border: `1px solid ${isDone ? 'var(--text-3)' : 'var(--line-4)'}`,
          background: isDone
            ? 'var(--text-3)'
            : isRunning
              ? 'var(--text-1)'
              : isBlocked
                ? 'var(--line-4)'
                : 'transparent',
        }}
      />
      <span
        dir="auto"
        className="bidi text-[12.5px] leading-[1.5]"
        style={{
          color: isDone
            ? 'var(--text-4)'
            : isBlocked
              ? 'var(--text-3)'
              : 'var(--text-2)',
          textDecoration: isDone ? 'line-through' : undefined,
          textDecorationColor: 'var(--line-3)',
        }}
      >
        {step.description}
      </span>
      {isRunning && (
        <motion.span
          aria-hidden
          className="mt-[6px] inline-block h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: 'var(--text-2)' }}
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: easeOut }}
        />
      )}
      {isBlocked && (
        <span
          className="mono shrink-0 text-[10px]"
          style={{ color: 'var(--text-4)' }}
        >
          blocked
        </span>
      )}
    </motion.li>
  )
}
