import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentPhase, ApprovalDecision } from './contract'
import {
  answerQuestion as answerQuestionBlock,
  blocksFromHistory,
  blocksToHistory,
  saneBlocks,
  decideApproval,
  phaseOf,
  reduce,
  type Block,
} from './blocks'
import { AguiBridge } from './agui'
import {
  api,
  runAgentStream,
  type ChatMessage,
  type ServerConfig,
  type ServerMessage,
} from './api'
import { sound } from './sound'

/* ---------------------------------------------------------------------------
   The one place the interface consumes a stream — now one stream per thread.

   The first version held a single column. That made "a turn is in flight" a
   property of the app rather than of a thread, so starting a second job meant
   cancelling the first, and switching threads threw away the reply still
   arriving. Both are wrong for an agent: a long task is exactly when you want
   to go and do something else.

   So state is keyed by thread id. A run keeps writing into its own entry while
   the reader is somewhere else; switching back shows it where it got to. The
   only global things left are approvals, which are addressed by id anyway.
   --------------------------------------------------------------------------- */

interface ThreadRun {
  blocks: Block[]
  running: boolean
  error: string | null
  usage: { promptTokens: number; completionTokens: number; model?: string } | null
  controller: AbortController | null
  /** when the current turn started / ended — the agents workbench times a run */
  startedAt?: number
  endedAt?: number
}

function emptyRun(): ThreadRun {
  return { blocks: [], running: false, error: null, usage: null, controller: null }
}

const PHASE_WORD: Record<AgentPhase, string> = {
  idle: 'ready',
  thinking: 'thinking',
  streaming: 'writing',
  tool: 'running a tool',
  awaiting: 'waiting on you',
  error: 'error',
  done: 'done',
}

/** one thread, as the agents workbench sees it — a run is a thing you watch */
export interface AgentSummary {
  id: string
  running: boolean
  phase: AgentPhase
  /** the last thing the reader asked for */
  goal: string
  /** the live step or the plan's progress — never a raw event dump */
  detail: string
  tools: number
  /** an approval or a question is parked on this run */
  waiting: boolean
  startedAt?: number
  endedAt?: number
}

/** rebuild the conversation from the blocks, which is the only source of truth */
export function blocksToMessages(blocks: Block[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const b of blocks) {
    if (b.k === 'user') out.push({ role: 'user', content: b.text })
    else if (b.k === 'text' && b.text.trim())
      out.push({ role: 'assistant', content: b.text })
  }
  return out
}

export interface UseAgentStreamOptions {
  config: ServerConfig | null
  sessionId: string | null
  mode?: 'ask' | 'plan' | 'agent'
  /** 'auto' runs every write without stopping for approval */
  trust?: 'ask' | 'auto'
  /** confidence gate for full-trust writes — below the threshold they park */
  confidence?: { threshold: number; decisionModel?: string }
  /** the model for THIS message, from the router; null keeps the configured one */
  pickModel?: (text: string) => string | null
  /** what the reader asked to be called — injected into the system prompt */
  userName?: string
  /** called with the finished reply, so the caller can refresh its thread list */
  onAssistantDone?: (text: string) => void
}

export function useAgentStream({
  config,
  sessionId,
  mode,
  trust,
  confidence,
  pickModel,
  userName,
  onAssistantDone,
}: UseAgentStreamOptions) {
  /* the ref is the immediate truth — two streams can patch in the same tick,
     and reading React state there would race */
  const runsRef = useRef<Record<string, ThreadRun>>({})
  const [runs, setRunsState] = useState<Record<string, ThreadRun>>({})

  const patch = useCallback((id: string, fn: (run: ThreadRun) => ThreadRun) => {
    const next = { ...runsRef.current, [id]: fn(runsRef.current[id] ?? emptyRun()) }
    runsRef.current = next
    setRunsState(next)
  }, [])

  const activeId = sessionId ?? 'local'
  const active = runs[activeId] ?? emptyRun()
  const blocks = active.blocks
  const running = active.running
  const error = active.error
  const usage = active.usage

  /* ---- sending --------------------------------------------------------- */

  const send = useCallback(
    async (
      text: string,
      /** images the reader pasted — data URLs, sent as parts with the message */
      images: string[] = [],
      sessionIdOverride?: string,
      /** replay from this instead of the current column — used by retry */
      baseBlocks?: Block[],
    ) => {
      const trimmed = text.trim()
      const target = sessionIdOverride ?? sessionId ?? 'local'
      const current = runsRef.current[target] ?? emptyRun()

      /* a thread runs one turn at a time; another thread is free to run its own */
      if (!trimmed || current.running) return
      /* the router's answer for this message, resolved once at send time — the
         run stays on the model it started on, even if the reader switches */
      const routed = pickModel?.(trimmed) ?? null
      /* the config carries the provider and the key; without it there is no
         run to make — the router can choose a model, not a provider */
      if (!config || (!routed && !config.model)) {
        patch(target, (r) => ({ ...r, error: 'No model selected. Open Settings and pick one.' }))
        return
      }

      const userBlock: Block = {
        k: 'user',
        id: `u-${Date.now()}`,
        text: trimmed,
        ...(images.length ? { images } : {}),
      }
      const history = [...(baseBlocks ?? current.blocks), userBlock]
      const controller = new AbortController()

      patch(target, (r) => ({
        ...r,
        blocks: history,
        running: true,
        error: null,
        controller,
        startedAt: Date.now(),
        endedAt: undefined,
      }))
      sound.play('send')

      const bridge = new AguiBridge()
      let assistantText = ''

      /* the run's config: the router's model when it has one, the configured
         one otherwise */
      const runConfig: ServerConfig = { ...config, model: routed ?? config.model }

      const apply = (events: ReturnType<AguiBridge['push']>) => {
        if (events.length === 0) return
        patch(target, (r) => ({ ...r, blocks: events.reduce(reduce, r.blocks) }))
      }

      try {
        await runAgentStream(
          {
            threadId: target,
            sessionId: target === 'local' ? undefined : target,
            messages: blocksToMessages(history),
            /* the real conversation: tool calls and their results, not just prose */
            history: blocksToHistory(history),
            config: runConfig,
            mode,
            trust,
            confidence,
            userName,
          },
          (event) => {
            if (
              event.type === 'TEXT_MESSAGE_CONTENT' &&
              typeof event.delta === 'string'
            ) {
              assistantText += event.delta
            }
            if (
              event.type === 'RUN_FINISHED' &&
              (event as { result?: { promptTokens?: number; completionTokens?: number; model?: string } })
                .result
            ) {
              const r = (
                event as { result?: { promptTokens?: number; completionTokens?: number; model?: string } }
              ).result!
              patch(target, (run) => ({
                ...run,
                usage: {
                  promptTokens: r.promptTokens ?? 0,
                  completionTokens: r.completionTokens ?? 0,
                  model: r.model,
                },
              }))
            }
            if (event.type === 'TOOL_CALL_START') sound.play('toolStart')
            if (event.type === 'TOOL_CALL_RESULT') sound.play('toolDone')
            if (event.type === 'RUN_ERROR') sound.play('error')
            if (event.type === 'RUN_FINISHED') sound.play('done')
            apply(bridge.push(event))
          },
          controller.signal,
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          apply(bridge.flush())
        } else {
          const message = (err as Error).message
          patch(target, (r) => ({ ...r, error: message }))
          apply([{ kind: 'error', at: Date.now(), id: `err-${Date.now()}`, message }])
        }
      } finally {
        apply(bridge.flush())
        patch(target, (r) => ({ ...r, running: false, controller: null, endedAt: Date.now() }))
        if (assistantText.trim()) onAssistantDone?.(assistantText)
      }
    },
    [config, sessionId, mode, trust, confidence, pickModel, userName, onAssistantDone, patch],
  )

  /** stop one thread's turn; no argument means the one on screen */
  const stop = useCallback(
    (id?: string) => {
      const target = id ?? sessionId ?? 'local'
      runsRef.current[target]?.controller?.abort()
    },
    [sessionId],
  )

  /**
   * Send the last thing the reader asked for, again.
   *
   * A failed turn leaves an error block and no reply. Retrying has to start
   * from the column *before* that turn, or the model would be handed its own
   * error as conversation history.
   */
  const retry = useCallback(
    async (sessionIdOverride?: string) => {
      const target = sessionIdOverride ?? sessionId ?? 'local'
      const current = runsRef.current[target]?.blocks ?? []
      let idx = -1
      for (let i = current.length - 1; i >= 0; i--) {
        if (current[i].k === 'user') {
          idx = i
          break
        }
      }
      if (idx === -1) return
      const block = current[idx] as Extract<Block, { k: 'user' }>
      await send(block.text, block.images ?? [], sessionIdOverride, current.slice(0, idx))
    },
    [send, sessionId],
  )

  /* ---- restoring a thread ---------------------------------------------- */

  const load = useCallback(
    (rows: ServerMessage[], id?: string) => {
      const target = id ?? sessionId ?? 'local'
      const current = runsRef.current[target]
      /* a live column is newer than storage — never overwrite a run in flight */
      if (current?.running || (current?.blocks.length ?? 0) > 0) return
      patch(target, () => ({ ...emptyRun(), blocks: blocksFromHistory(rows) }))
    },
    [sessionId, patch],
  )

  /** restore a thread from its snapshot — the whole run, not just the words */
  const loadBlocks = useCallback(
    (blocks: Block[]) => {
      const target = sessionId ?? 'local'
      const current = runsRef.current[target]
      /* a live column is newer than storage — never overwrite a run in flight */
      if (current?.running) return
      patch(target, () => ({ ...emptyRun(), blocks: saneBlocks(blocks) }))
    },
    [sessionId, patch],
  )

  const reset = useCallback(
    (id?: string) => {
      const target = id ?? sessionId ?? 'local'
      runsRef.current[target]?.controller?.abort()
      patch(target, () => emptyRun())
    },
    [sessionId, patch],
  )

  /**
   * Put a line in the column that did not come from the model — used by the
   * slash commands to answer /help without spending a model turn.
   */
  const inject = useCallback(
    (text: string) => {
      const target = sessionId ?? 'local'
      patch(target, (r) => ({
        ...r,
        blocks: [
          ...r.blocks,
          { k: 'text', id: `sys-${Date.now()}`, text, live: false },
        ],
      }))
    },
    [sessionId, patch],
  )

  /* leaving the app stops every stream it started */
  useEffect(() => {
    return () => {
      for (const run of Object.values(runsRef.current)) run.controller?.abort()
    }
  }, [])

  /* ---- approvals ------------------------------------------------------- */

  /** an approval belongs to a thread, but its id is global — settle it wherever it is */
  const settle = useCallback(
    (fn: (blocks: Block[]) => Block[]) => {
      const next: Record<string, ThreadRun> = {}
      for (const [id, run] of Object.entries(runsRef.current)) {
        next[id] = { ...run, blocks: fn(run.blocks) }
      }
      runsRef.current = next
      setRunsState(next)
    },
    [],
  )

  const resolveApproval = useCallback(
    async (id: string, decision: ApprovalDecision) => {
      sound.play(decision === 'approve' ? 'approve' : 'select')
      settle((blocks) => decideApproval(blocks, id, decision))
      try {
        await api.approve(id, decision === 'approve')
      } catch (err) {
        patch(sessionId ?? 'local', (r) => ({ ...r, error: (err as Error).message }))
      }
    },
    [settle, patch, sessionId],
  )

  const answerQuestion = useCallback(
    async (id: string, answer: string | null) => {
      sound.play('select')
      settle((blocks) => answerQuestionBlock(blocks, id, answer))
      try {
        await api.answerQuestion(id, answer)
      } catch (err) {
        patch(sessionId ?? 'local', (r) => ({ ...r, error: (err as Error).message }))
      }
    },
    [settle, patch, sessionId],
  )

  const phase: AgentPhase = useMemo(() => {
    if (running) return phaseOf(blocks, false)
    if (blocks.length === 0) return 'idle'
    const settled = phaseOf(blocks, false)
    /* a run that is not in flight is finished — unless it stopped on something
       that still needs the reader, which is not "done" in any useful sense */
    if (settled === 'awaiting' || settled === 'error') return settled
    return 'done'
  }, [running, blocks])

  /** which threads have a turn in flight — the drawer shows a dot for each */
  const runningIds = useMemo(
    () =>
      Object.entries(runs)
        .filter(([, run]) => run.running)
        .map(([id]) => id),
    [runs],
  )

  /** the same threads, summarised for the agents workbench: what each one is
      doing right now, how long it has been at it, and whether it needs a human.
      Running first, then most-recently-finished — a list you can act on. */
  const agents = useMemo<AgentSummary[]>(() => {
    const out: AgentSummary[] = []
    for (const [id, run] of Object.entries(runs)) {
      if (run.blocks.length === 0 && !run.running) continue
      const lastUser = [...run.blocks]
        .reverse()
        .find((b) => b.k === 'user') as Extract<Block, { k: 'user' }> | undefined
      const plan = [...run.blocks]
        .reverse()
        .find((b) => b.k === 'plan') as Extract<Block, { k: 'plan' }> | undefined
      const tools = run.blocks.filter((b) => b.k === 'tool').length
      const waiting = run.blocks.some(
        (b) =>
          (b.k === 'approval' && !b.decision) || (b.k === 'question' && b.answer == null),
      )
      const phase: AgentPhase = run.running
        ? phaseOf(run.blocks, false)
        : run.blocks.length === 0
          ? 'idle'
          : (() => {
              const s = phaseOf(run.blocks, false)
              return s === 'awaiting' || s === 'error' ? s : 'done'
            })()
      let detail = PHASE_WORD[phase]
      if (plan) {
        const cur = plan.plan.steps.find((s) => s.status === 'in_progress')
        const done = plan.plan.steps.filter((s) => s.status === 'done').length
        detail = cur ? cur.description : `${done}/${plan.plan.steps.length} done`
      }
      out.push({
        id,
        running: run.running,
        phase,
        goal: lastUser?.text ?? 'New thread',
        detail,
        tools,
        waiting,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      })
    }
    out.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1
      return (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0)
    })
    return out
  }, [runs])

  return {
    blocks,
    phase,
    running,
    error,
    usage,
    runningIds,
    agents,
    send,
    stop,
    retry,
    load,
    loadBlocks,
    reset,
    inject,
    resolveApproval,
    answerQuestion,
  }
}
