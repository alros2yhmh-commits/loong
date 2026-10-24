import { motion } from 'motion/react'

/* ---------------------------------------------------------------------------
   The status bar — the fourth region.

   A desktop agent has a floor: what it is doing, where it is doing it, and
   what it costs. Everything here is read from the live run, never from a
   setting — the dot is the run, the model is the model that RAN, the plan is
   the plan that exists. 36px, pinned, and it never scrolls away.
   --------------------------------------------------------------------------- */

export interface StatusBarProps {
  running: boolean
  phase: string | null
  mode: 'ask' | 'plan' | 'agent'
  /** the model the last run actually used — the router picks per run */
  model: string
  /** steps done of the plan, when there is one */
  plan: { done: number; total: number } | null
  /** the folder the agent is working in */
  workspace: string | null
  /** prompt + completion tokens of the last run */
  usage: { promptTokens: number; completionTokens: number } | null
}

const PHASE_WORD: Record<string, string> = {
  idle: 'idle',
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running a tool',
  waiting: 'waiting for approval',
  error: 'failed',
}

export function StatusBar({
  running,
  phase,
  mode,
  model,
  plan,
  workspace,
  usage,
}: StatusBarProps) {
  const word = running ? (PHASE_WORD[phase ?? ''] ?? 'working') : 'idle'
  const folder = workspace ? (workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace) : 'no folder'
  const shortModel = model.length > 34 ? `${model.slice(0, 33)}…` : model

  return (
    <footer
      className="flex h-[36px] shrink-0 items-center gap-[14px] px-[16px]"
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--line-1)',
      }}
    >
      {/* the state: one dot, one word. The dot blinks only while working */}
      <span className="flex items-center gap-[6px]">
        {running ? (
          <motion.span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: 'var(--text-1)' }}
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: 'var(--line-3)' }}
          />
        )}
        <span className="t-tiny" style={{ color: 'var(--text-2)' }}>
          {word}
        </span>
      </span>

      <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
        {mode}
      </span>

      {plan && plan.total > 0 && (
        <span className="t-tiny" style={{ color: 'var(--text-2)' }}>
          plan {plan.done}/{plan.total}
        </span>
      )}

      {/* the rest is pushed right: the model and the folder are facts, the
          state is the thing you glance at */}
      <span className="flex-1" />
      {usage && (
        <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
          {(usage.promptTokens / 1000).toFixed(1)}k in · {(usage.completionTokens / 1000).toFixed(1)}k out
        </span>
      )}
      <span className="mono t-tiny max-w-[280px] truncate" style={{ color: 'var(--text-3)' }} title={model}>
        {shortModel || 'no model'}
      </span>
      <span className="t-tiny" style={{ color: 'var(--text-3)' }} title={workspace ?? 'no folder chosen'}>
        {folder}
      </span>
    </footer>
  )
}
