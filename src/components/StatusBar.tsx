import { motion } from 'motion/react'

/* ===========================================================================
   The status bar — the fourth region.

   A desktop agent has a floor: what it is doing, where it is doing it, and what
   it costs. Everything here is read from the live run, never from a setting —
   the dot is the run, the model is the model that RAN, the plan is the plan
   that exists. 36px, pinned, and it never scrolls away.
   =========================================================================== */

export interface StatusBarProps {
  running: boolean
  phase: string | null
  mode: 'ask' | 'plan' | 'agent'
  model: string
  plan: { done: number; total: number } | null
  workspace: string | null
  usage: { promptTokens: number; completionTokens: number; model?: string } | null
  health: boolean | null
}

const PHASE_WORD: Record<string, string> = {
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running a tool',
  waiting: 'waiting for approval',
}

export function StatusBar(p: StatusBarProps) {
  const word = p.running ? (PHASE_WORD[p.phase ?? ''] ?? 'working') : 'idle'
  const folder = p.workspace
    ? (p.workspace.split(/[\\/]/).filter(Boolean).pop() ?? p.workspace)
    : 'no folder'

  return (
    <footer
      className="flex h-[36px] shrink-0 items-center gap-[14px] px-[16px]"
      style={{ background: 'var(--surface)', borderTop: '1px solid var(--line-1)' }}
    >
      <span className="flex items-center gap-[6px]">
        {p.running ? (
          <motion.span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: 'var(--text-1)' }}
            animate={{ opacity: [1, 0.25, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: 'var(--line-3)' }} />
        )}
        <span className="t-tiny" style={{ color: 'var(--text-2)' }}>
          {word}
        </span>
      </span>

      <span className="t-tiny" style={{ color: 'var(--text-3)' }}>{p.mode}</span>

      {p.plan && p.plan.total > 0 && (
        <span className="t-tiny" style={{ color: 'var(--text-2)' }}>
          plan {p.plan.done}/{p.plan.total}
        </span>
      )}

      <span className="flex-1" />

      {p.health === false && (
        <span className="t-tiny" style={{ color: 'var(--text-3)' }} title="The agent process is not reachable">
          agent offline
        </span>
      )}

      {p.usage && (
        <span className="t-tiny" style={{ color: 'var(--text-3)' }}>
          {(p.usage.promptTokens / 1000).toFixed(1)}k in · {(p.usage.completionTokens / 1000).toFixed(1)}k out
        </span>
      )}

      <span className="t-tiny" style={{ color: 'var(--text-3)' }} title={p.workspace ?? 'no folder chosen'}>
        {folder}
      </span>
    </footer>
  )
}
