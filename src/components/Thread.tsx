import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentPhase, ApprovalDecision } from '../lib/contract'
import type { Block } from '../lib/blocks'
import { BlockView } from './Message'
import { Guilloche } from './Guilloche'
import { RunSummary } from './RunSummary'
import { spring } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The thread.

   One column, centred, sized for code and cards. Content scrolls in exactly one
   direction and nothing else on screen moves with it. While a turn is live the
   view follows the tail, but only if the reader is already at the tail — the
   moment they scroll up, the thread stops chasing them.
   --------------------------------------------------------------------------- */

interface ThreadProps {
  blocks: Block[]
  phase: AgentPhase
  onDecide: (id: string, d: ApprovalDecision) => void
  onAnswer: (id: string, answer: string | null) => void
  /** base size for prose in the thread, from Settings */
  fontSize: number
  /** the column itself is draggable from its gutters */
  onResizeStart: (e: React.PointerEvent) => void
  onResizeReset: () => void
  resizing: boolean
  /** which user turns can be undone, by run id */
  rewindTargets?: Record<string, string>
  onRewind?: (runId: string) => void
  /** a turn is in flight — the summary waits until it settles */
  running?: boolean
  /** undo the whole last run, from the summary */
  onRewindRun?: () => void
  canRewindRun?: boolean
  /** the column's own width grips — off for the right pane in split view */
  grips?: boolean
  /** bumps whenever a message is sent, so the view snaps to the new tail */
  pinTail?: number
}

function Grip({
  side,
  onPointerDown,
  onReset,
  dragging,
}: {
  side: 'left' | 'right'
  onPointerDown: (e: React.PointerEvent) => void
  onReset: () => void
  dragging: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Thread column width"
      title="Thread width — drag, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="absolute top-0 bottom-0 z-20 w-[7px] cursor-col-resize"
      style={{ [side]: -4 } as React.CSSProperties}
    >
      <div
        className="absolute inset-y-[24px] w-px"
        style={{
          [side === 'left' ? 'right' : 'left']: 3,
          background: dragging || hover ? 'var(--line-3)' : 'transparent',
          transition: 'background-color var(--dur-hover) var(--ease-out)',
        } as React.CSSProperties}
      />
    </div>
  )
}

/* Consecutive tool calls are one activity, not ten separate events. Grouping
   them gives the log a single edge and a single count, which is what makes the
   prose above it readable again. */
type Group =
  | { kind: 'block'; block: Block; index: number }
  | { kind: 'tools'; items: { block: Block; index: number }[] }

function groupBlocks(blocks: Block[]): Group[] {
  const out: Group[] = []
  let run: { block: Block; index: number }[] = []
  const flush = () => {
    if (run.length) {
      out.push({ kind: 'tools', items: run })
      run = []
    }
  }
  blocks.forEach((block, index) => {
    if (block.k === 'tool') run.push({ block, index })
    else {
      flush()
      out.push({ kind: 'block', block, index })
    }
  })
  flush()
  return out
}

function msLabel(ms: number): string {
  return ms < 1_000 ? `${Math.round(ms)}ms` : `${(ms / 1_000).toFixed(1)}s`
}

export function Thread({
  blocks,
  phase,
  onDecide,
  onAnswer,
  fontSize,
  onResizeStart,
  onResizeReset,
  resizing,
  rewindTargets,
  onRewind,
  running = false,
  onRewindRun,
  canRewindRun = false,
  grips = true,
  pinTail = 0,
}: ThreadProps) {
  const scroller = useRef<HTMLDivElement>(null)
  /* the view follows the tail while the reader is at the tail. Scroll up to
     read something and it stops chasing you; the "jump to latest" pill brings
     it back. This is state, not a ref, because the pill renders off it. */
  const [follow, setFollow] = useState(true)
  /* a very long thread must not mount thousands of nodes: render the tail, and
     let the reader pull earlier blocks in on demand */
  const [limit, setLimit] = useState(220)

  const scrollToBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  /* follow while at the tail — on new blocks, on a phase change, and the moment
     the reader comes back to the tail on their own */
  useEffect(() => {
    if (!follow) return
    const r = requestAnimationFrame(scrollToBottom)
    return () => cancelAnimationFrame(r)
  }, [blocks, phase, follow, scrollToBottom])

  /* a sent message (or a run starting) always snaps to the tail — the reader
     just asked for something; following is the default they expect */
  useEffect(() => {
    if (pinTail <= 0) return
    setFollow(true)
  }, [pinTail])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 90)
  }

  if (blocks.length === 0) {
    return (
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative w-full max-w-[560px] px-[24px]">
          <div
            className="absolute inset-x-[-40px] top-[-38px] overflow-hidden opacity-70"
            style={{ color: 'var(--guilloche)' }}
          >
            <Guilloche
              width={640}
              height={190}
              lines={15}
              period={72}
              amplitude={7}
              spread={2.4}
            />
          </div>
          <div className="relative text-center">
            <h1 className="display m-0 text-[19px]">Loong</h1>
            <p
              className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.65]"
              style={{ color: 'var(--text-3)' }}
            >
              A thread starts empty and stays out of the way. Ask for something,
              and the work shows up as it happens.
            </p>
            <p
              className="mono mt-[22px] text-[11px]"
              style={{ color: 'var(--text-4)' }}
            >
              ⌘K commands · ⌘, settings · right edge for saved threads
            </p>
          </div>
        </div>
      </div>
    )
  }

  const start = Math.max(0, blocks.length - limit)
  const visible = start > 0 ? blocks.slice(start) : blocks

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-scroll-region
        onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
      <div
        className="relative mx-auto mt-auto flex w-full flex-col gap-[14px] px-[24px] pt-[28px] pb-[22px]"
        style={{ maxWidth: 'var(--thread-measure)', fontSize }}
      >
        {grips && (
          <>
            <Grip
              side="left"
              onPointerDown={onResizeStart}
              onReset={onResizeReset}
              dragging={resizing}
            />
            <Grip
              side="right"
              onPointerDown={onResizeStart}
              onReset={onResizeReset}
              dragging={resizing}
            />
          </>
        )}
        {start > 0 && (
          <button
            type="button"
            className="ctl self-center rounded-[6px] px-[10px] py-[4px] text-[11px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={() => setLimit((l) => l + 220)}
          >
            show {start.toLocaleString()} earlier
          </button>
        )}
        {groupBlocks(visible).map((group, key) => {
          if (group.kind === 'block') {
            return (
              <div key={key} id={`blk-${start + group.index}`}>
                <BlockView
                  block={group.block}
                  onDecide={onDecide}
                  onAnswer={onAnswer}
                  rewindTargets={rewindTargets}
                  onRewind={onRewind}
                />
              </div>
            )
          }

          /* a lone tool stays a card; a run of them gets one edge and one count */
          if (group.items.length === 1) {
            const only = group.items[0]
            return (
              <div key={key} id={`blk-${start + only.index}`}>
                <BlockView
                  block={only.block}
                  onDecide={onDecide}
                  onAnswer={onAnswer}
                  rewindTargets={rewindTargets}
                  onRewind={onRewind}
                />
              </div>
            )
          }

          const total = group.items.reduce(
            (n, it) =>
              n + (it.block.k === 'tool' ? it.block.durationMs ?? it.block.result?.ms ?? 0 : 0),
            0,
          )

          return (
            <div
              key={key}
              className="flex flex-col gap-[5px] pl-[9px]"
              style={{ borderLeft: '1px solid var(--line-2)' }}
            >
              <div
                className="mono flex items-center gap-[7px] text-[10px] tracking-[0.06em] uppercase"
                style={{ color: 'var(--text-4)' }}
              >
                <span>{group.items.length} tools</span>
                {total > 0 && <span>· {msLabel(total)}</span>}
              </div>
              {group.items.map((it) => (
                <div key={it.index} id={`blk-${start + it.index}`}>
                  <BlockView
                    block={it.block}
                    onDecide={onDecide}
                    onAnswer={onAnswer}
                    rewindTargets={rewindTargets}
                    onRewind={onRewind}
                  />
                </div>
              ))}
            </div>
          )
        })}

        {/* the result, once the turn settles: what ran, what changed, did the
            checks pass — instead of asking the reader to reconstruct it from
            forty cards above */}
        {!running && (
          <RunSummary
            blocks={blocks}
            running={running}
            onJump={(i) =>
              document
                .getElementById(`blk-${i}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            onRewind={onRewindRun}
            canRewind={canRewindRun}
          />
        )}
        </div>
      </div>

      {/* the view is detached from the tail — say so, and offer the way back */}
      <AnimatePresence>
        {!follow && (
          <motion.button
            type="button"
            className="ctl absolute right-[20px] bottom-[16px] z-20 flex items-center gap-[6px] rounded-full px-[11px] py-[6px]"
            style={{ border: '1px solid var(--line-4)', background: 'var(--canvas)', color: 'var(--text-2)' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={spring.settle}
            onClick={() => {
              setFollow(true)
              requestAnimationFrame(scrollToBottom)
            }}
            title="Jump to the latest"
            aria-label="Jump to the latest"
          >
            <span className="mono text-[11px]">latest</span>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 3v9M4.5 8.5L8 12l3.5-3.5" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
