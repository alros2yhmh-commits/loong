import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Block } from '../lib/blocks'
import { dur, easeOut, spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The run, summarized.

   The first version drew one unlabeled tick per tool call on a shared axis.
   It was accurate and unreadable: a strip of marks with no names, no counts and
   no answer to the only questions a person has after a long run — what changed,
   did the checks pass, how long did it take.

   This is the same data as a sentence: "6 tools · 3 files · 4.2s · checks ✓",
   expandable into the spans and the files. It sits at the end of the thread
   because that is where a result belongs, not in a bar above the work.
   --------------------------------------------------------------------------- */

function formatMs(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const s = Math.round(ms / 1_000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** the first meaningful line of a tool's output, for the failure hint */
function firstLine(output: string): string {
  const line = output.split('\n').find((l) => l.trim()) ?? ''
  return line.length > 110 ? `${line.slice(0, 110)}…` : line
}

interface Span {
  index: number
  name: string
  title: string
  ms: number
  ok: boolean
  live: boolean
  /** the first line of a failed tool's output — why it failed, in place */
  error?: string
}

export function RunSummary({
  blocks,
  running,
  onJump,
  onRewind,
  canRewind,
}: {
  blocks: Block[]
  running: boolean
  onJump?: (index: number) => void
  onRewind?: () => void
  canRewind?: boolean
}) {
  const [open, setOpen] = useState(false)

  const spans: Span[] = []
  const files = new Set<string>()
  let checksOk: boolean | null = null
  let checksOutput = ''
  let errors = 0

  blocks.forEach((b, index) => {
    if (b.k === 'error') {
      errors += 1
      return
    }
    if (b.k !== 'tool') return

    const name = b.call.wire ?? b.call.tool
    const input = (b.call.input ?? {}) as Record<string, unknown>

    if (name === 'run_verification') {
      checksOk = b.result?.ok ?? null
      checksOutput = (b.result?.output ?? '').split('\n')[0]?.slice(0, 120) ?? ''
    }

    if (name === 'propose_changes' && Array.isArray(input.diff)) {
      for (const d of input.diff as { path?: unknown }[]) {
        if (typeof d?.path === 'string') files.add(d.path)
      }
    } else if (
      (name === 'write_file' || name === 'edit_file' || name === 'delete_file') &&
      typeof input.path === 'string'
    ) {
      files.add(input.path)
    }

    spans.push({
      index,
      name,
      title: b.call.title,
      ms: b.durationMs ?? b.result?.ms ?? 0,
      ok: b.result?.ok ?? true,
      live: !b.result,
      error: b.result?.ok === false ? firstLine(b.result?.output ?? '') : undefined,
    })
  })

  /* a pure chat turn has no run to summarize */
  if (spans.length === 0) return null

  /* a failed TOOL is not a failed RUN: one refused command used to label the
     whole run failed, which is how a user ends up unable to tell a hiccup
     from a collapse. The run failed only when it errored or the checks did. */
  const toolFails = spans.filter((s) => !s.ok).length
  const runFailed = errors > 0 || checksOk === false
  const totalMs = spans.reduce((sum, s) => sum + s.ms, 0)
  const done = spans.filter((s) => !s.live).length
  const status = running ? 'running' : runFailed ? 'failed' : 'done'

  const progress = spans.length ? (running ? done / spans.length : 1) : 0

  return (
    <div
      className="overflow-hidden rounded-[9px]"
      style={{ border: '1px solid var(--line-2)', background: 'var(--surface)' }}
    >
      <button
        type="button"
        className="ctl flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="mono shrink-0 text-[10px] tracking-[0.08em] uppercase"
          style={{ color: status === 'failed' ? 'var(--text-1)' : 'var(--text-3)' }}
        >
          {status === 'failed' ? 'run · failed' : status === 'running' ? 'run · live' : 'run'}
        </span>

        <span className="mono min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--text-2)' }}>
          {spans.length} {spans.length === 1 ? 'tool' : 'tools'}
          {toolFails > 0 && ` · ${toolFails} failed`}
          {files.size > 0 && ` · ${files.size} ${files.size === 1 ? 'file' : 'files'}`}
          {totalMs > 0 && ` · ${formatMs(totalMs)}`}
        </span>

        {checksOk !== null && (
          <span
            className="mono shrink-0 text-[10.5px]"
            style={{ color: checksOk ? 'var(--text-2)' : 'var(--text-1)' }}
            title={checksOutput}
          >
            checks {checksOk ? '✓' : '×'}
          </span>
        )}

        <span
          className="mono shrink-0 text-[10.5px]"
          style={{ color: 'var(--text-4)' }}
        >
          {open ? '−' : '+'}
        </span>
      </button>

      {/* the progress hairline: filled as tools finish, never a moving stripe */}
      <div className="h-[2px] w-full" style={{ background: 'var(--line-1)' }}>
        <motion.div
          className="h-full"
          style={{ background: status === 'failed' ? 'var(--text-1)' : 'var(--line-5)' }}
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ duration: dur.panel, ease: easeOut }}
        />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.settle}
            className="overflow-hidden"
          >
            <div className="px-[12px] py-[9px]">
              <div className="flex flex-col gap-[3px]">
                {spans.map((s) => (
                  <button
                    key={`${s.index}-${s.name}`}
                    type="button"
                    className="ctl flex w-full flex-col items-start gap-[1px] rounded-[4px] px-[3px] py-[2px] text-left"
                    onClick={() => onJump?.(s.index)}
                    title={s.title}
                  >
                    <span className="flex w-full items-baseline gap-[8px]">
                      <span
                        className="mono w-[13px] shrink-0 text-[10px]"
                        style={{ color: s.ok ? 'var(--text-4)' : 'var(--text-1)' }}
                      >
                        {s.live ? '›' : s.ok ? '✓' : '×'}
                      </span>
                      <span
                        className="mono w-[128px] shrink-0 truncate text-[10.5px]"
                        style={{ color: 'var(--text-2)' }}
                      >
                        {s.name}
                      </span>
                      <span
                        className="mono min-w-0 flex-1 truncate text-[10.5px]"
                        style={{ color: 'var(--text-4)' }}
                      >
                        {s.title}
                      </span>
                      <span
                        className="mono shrink-0 text-[10px]"
                        style={{ color: 'var(--text-4)' }}
                      >
                        {s.ms > 0 ? formatMs(s.ms) : '—'}
                      </span>
                    </span>
                    {s.error && (
                      <span
                        className="mono w-full truncate pl-[21px] text-[10px]"
                        style={{ color: 'var(--text-3)' }}
                      >
                        {s.error}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {files.size > 0 && (
                <div className="mt-[8px] border-t pt-[7px]" style={{ borderColor: 'var(--line-1)' }}>
                  <p
                    className="mono m-0 mb-[3px] text-[9.5px] tracking-[0.08em] uppercase"
                    style={{ color: 'var(--text-4)' }}
                  >
                    changed
                  </p>
                  {[...files].slice(0, 8).map((f) => (
                    <p
                      key={f}
                      className="mono m-0 truncate text-[10.5px] leading-[1.6]"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {f}
                    </p>
                  ))}
                  {files.size > 8 && (
                    <p className="mono m-0 text-[10px]" style={{ color: 'var(--text-4)' }}>
                      +{files.size - 8} more
                    </p>
                  )}
                </div>
              )}

              {canRewind && onRewind && (
                <button
                  type="button"
                  className="ctl mt-[8px] rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
                  style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                  onClick={onRewind}
                >
                  ⤺ put these files back
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
