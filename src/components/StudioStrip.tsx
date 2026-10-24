import { useMemo } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Block } from '../lib/blocks'
import type { AgentPhase } from '../lib/contract'
import { dur, easeOut } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   The studio strip — four instruments in one hairline row, under the run bar.

   1. Context minimap: every block in the thread as a segment, so the shape of
      the run is visible before you scroll it (tools dense, prose sparse).
   2. Scrubber: a slider over the tools this run called; dragging jumps the
      thread to that card. The trace existed; the handle did not.
   3. Presence: one dot that breathes with the phase — idle, thinking, running,
      failed. Monochrome, no colour, no icon.
   4. Zen: dims every block but the active one, for reading a long run.
   --------------------------------------------------------------------------- */

const KIND_OPACITY: Record<string, number> = {
  tool: 0.85,
  text: 0.45,
  thinking: 0.25,
  plan: 0.6,
  error: 1,
  notice: 0.3,
  approval: 0.7,
  question: 0.7,
}

function Presence({ phase, running }: { phase: AgentPhase; running: boolean }) {
  const reduced = useReducedMotion()
  const state = running ? (phase === 'thinking' ? 'thinking' : 'running') : phase === 'error' ? 'failed' : 'idle'
  return (
    <span className="flex items-center gap-[6px]" title={state}>
      <motion.span
        className="block h-[5px] w-[5px] rounded-full"
        style={{ background: 'var(--text-2)' }}
        animate={
          reduced
            ? undefined
            : state === 'thinking'
              ? { opacity: [0.25, 1, 0.25], scale: [0.85, 1.1, 0.85] }
              : state === 'running'
                ? { opacity: [0.55, 1, 0.55], scale: 1 }
                : state === 'failed'
                  ? { opacity: 1, scale: 1 }
                  : { opacity: 0.35, scale: 1 }
        }
        transition={
          state === 'thinking'
            ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
            : state === 'running'
              ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
              : { duration: dur.hover }
        }
      />
      <span className="mono text-[10px] tracking-[0.08em] uppercase" style={{ color: 'var(--text-4)' }}>
        {state}
      </span>
    </span>
  )
}

export function StudioStrip({
  blocks,
  phase,
  running,
  zen,
  onZen,
}: {
  blocks: Block[]
  phase: AgentPhase
  running: boolean
  zen: boolean
  onZen: () => void
}) {
  const tools = useMemo(() => blocks.filter((b) => b.k === 'tool' && b.result), [blocks])
  const segments = useMemo(() => blocks.slice(-160), [blocks])

  if (blocks.length === 0) return null

  const jump = (index: number) => {
    const tool = tools[index]
    if (!tool || tool.k !== 'tool') return
    const el = document.querySelector(`[data-tool-card="${tool.call.id}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="flex items-center gap-[10px] px-[24px] pt-[6px]">
      {/* the run, as a shape */}
      <div
        className="flex h-[10px] flex-1 items-end gap-[1px] overflow-hidden rounded-[2px]"
        style={{ maxWidth: 320 }}
        title="the run, block by block"
      >
        {segments.map((b, i) => (
          <motion.span
            key={b.k === 'tool' ? b.call.id : `${b.k}-${i}`}
            initial={{ scaleY: 0.2, opacity: 0 }}
            animate={{ scaleY: 1, opacity: KIND_OPACITY[b.k] ?? 0.4 }}
            transition={{ duration: dur.hover, ease: easeOut }}
            className="block w-[3px] shrink-0 rounded-[1px]"
            style={{ height: b.k === 'tool' ? 10 : b.k === 'error' ? 10 : 6, background: 'var(--text-2)', transformOrigin: 'bottom' }}
          />
        ))}
      </div>

      {/* the tools, as a handle */}
      {tools.length > 1 && (
        <input
          type="range"
          min={0}
          max={tools.length - 1}
          defaultValue={tools.length - 1}
          onChange={(e) => jump(Number(e.target.value))}
          className="h-[10px] w-[90px] cursor-pointer accent-[var(--text-3)]"
          style={{ accentColor: 'var(--text-3)' }}
          title={`jump between the ${tools.length} tools of this run`}
          aria-label="scrub the tools of this run"
        />
      )}

      <Presence phase={phase} running={running} />

      <button
        type="button"
        onClick={onZen}
        className="ctl mono shrink-0 rounded-[5px] px-[6px] py-[2px] text-[10px] tracking-[0.06em] uppercase"
        style={{
          border: `1px solid ${zen ? 'var(--line-5)' : 'var(--line-2)'}`,
          color: zen ? 'var(--text-1)' : 'var(--text-4)',
          background: zen ? 'var(--surface-sunken)' : 'transparent',
        }}
        title={zen ? 'show every block again' : 'dim everything but the active block'}
        aria-pressed={zen}
      >
        zen
      </button>
    </div>
  )
}
