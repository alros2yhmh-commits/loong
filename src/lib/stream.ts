import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, API_BASE, authHeaders, type Settings } from './api'
import { fold, toAgentHistory, type AgentEvent, type Block } from './blocks'

/* ===========================================================================
   The one place the interface consumes a stream.

   EventSource cannot POST, and the run needs a body — so this is a hand-rolled
   reader over fetch: it opens the stream, splits on the SSE frame boundary, and
   folds each event into that thread's block list.

   It used to hold ONE run. Opening another thread aborted the first, which
   meant a long job stopped the moment the reader looked at something else.
   State is now keyed by thread id: every session has its own controller, its
   own generation counter, its own blocks and its own usage. Switching tabs is
   a change of which slot is displayed, not a cancellation — the server already
   runs each run in its own async context, so nothing below this layer needed
   to change.

   The generation counter still does its original job: a superseded fold is
   dropped, so a retried run never appends to the transcript of the run it
   replaced.
   =========================================================================== */

export interface RunResult {
  /** false when this run was superseded by another run on the same thread */
  completed: boolean
  blocks: Block[]
}

export type RunPhase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting'

export type StreamUsage = {
  promptTokens: number
  completionTokens: number
  model?: string
}

export interface SessionView {
  blocks: Block[]
  running: boolean
  phase: RunPhase
  error: string | null
  usage: StreamUsage | null
}

export interface RunBody {
  threadId: string
  sessionId?: string
  messages: { role: string; content: string }[]
  settings: Settings
  capabilities?: Record<string, unknown>
  initialBlocks: Block[]
}

export interface StreamsHandle {
  /** the slot for the visible thread; an empty view when nothing is open */
  view: SessionView
  /** every thread this window holds state for — live or merely loaded */
  slots: string[]
  /** threads with a run in flight right now, in any tab */
  runningIds: string[]
  /** true when this thread already has an in-memory transcript */
  loaded: (threadId: string) => boolean
  run: (body: RunBody) => Promise<RunResult>
  stop: (threadId: string) => void
  setBlocks: (threadId: string, blocks: Block[]) => void
  clearError: (threadId?: string) => void
  /** forget a thread entirely — used when it is deleted or its tab is closed */
  drop: (threadId: string) => void
}

const EMPTY: SessionView = {
  blocks: [],
  running: false,
  phase: 'idle',
  error: null,
  usage: null,
}

export function useSessionStreams(activeId: string | null): StreamsHandle {
  const [views, setViews] = useState<Record<string, SessionView>>({})
  const controllers = useRef<Record<string, AbortController>>({})
  const generations = useRef<Record<string, number>>({})
  const alive = useRef(true)
  /* the newest blocks per thread, readable from callbacks that must not wait
     for a render — Stop has to persist what is on screen right now */
  const latest = useRef<Record<string, SessionView>>({})

  useEffect(() => {
    latest.current = views
  }, [views])

  useEffect(() => {
    alive.current = true
    return () => {
      /* unmount tears the window down; a run cannot outlive its reader */
      alive.current = false
      for (const c of Object.values(controllers.current)) c.abort()
    }
  }, [])

  const patch = useCallback((id: string, next: Partial<SessionView>) => {
    if (!alive.current) return
    setViews((prev) => {
      const base = prev[id] ?? EMPTY
      return { ...prev, [id]: { ...base, ...next } }
    })
  }, [])

  const stop = useCallback((id: string) => {
    /* bump the generation first: the reader's finally block must not resurrect
       the running flag it is about to clear */
    generations.current[id] = (generations.current[id] ?? 0) + 1
    controllers.current[id]?.abort()
    delete controllers.current[id]
    const blocks = latest.current[id]?.blocks
    if (blocks?.length) void api.saveBlocks(id, blocks).catch(() => {})
    setViews((prev) =>
      prev[id] ? { ...prev, [id]: { ...prev[id], running: false, phase: 'idle' } } : prev,
    )
  }, [])

  const drop = useCallback((id: string) => {
    generations.current[id] = (generations.current[id] ?? 0) + 1
    controllers.current[id]?.abort()
    delete controllers.current[id]
    setViews((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const run = useCallback(
    async (body: RunBody): Promise<RunResult> => {
      const id = body.threadId
      /* a second send on the same thread replaces the first, deliberately */
      controllers.current[id]?.abort()
      const my = (generations.current[id] = (generations.current[id] ?? 0) + 1)
      const ac = new AbortController()
      controllers.current[id] = ac
      let collected = body.initialBlocks
      let phase: RunPhase = 'thinking'

      setViews((prev) => ({
        ...prev,
        [id]: {
          blocks: body.initialBlocks,
          running: true,
          phase: 'thinking',
          error: null,
          usage: prev[id]?.usage ?? null,
        },
      }))

      const stillMine = () => generations.current[id] === my && alive.current

      try {
        const res = await fetch(`${API_BASE || 'http://127.0.0.1:5274'}/api/agent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            threadId: body.threadId,
            sessionId: body.sessionId,
            messages: body.messages,
            history: toAgentHistory(body.initialBlocks),
            mode: body.settings.mode,
            trust: body.settings.trust,
            route: body.settings.route,
            config: { provider: body.settings.provider, model: body.settings.model },
            userName: body.settings.userName,
            capabilities: body.capabilities,
          }),
          signal: ac.signal,
        })

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `${res.status} ${res.statusText}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!stillMine()) break
          buffer += decoder.decode(value, { stream: true })

          let cut = buffer.indexOf('\n\n')
          while (cut >= 0) {
            const frame = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            const data = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n')
            if (data && data !== '[DONE]') {
              try {
                const e = JSON.parse(data) as AgentEvent
                if (!stillMine()) break
                if (e.type === 'TEXT_MESSAGE_CONTENT') phase = 'streaming'
                if (e.type === 'TOOL_CALL_START') phase = 'tool'
                if (e.type === 'CUSTOM' && e.name === 'loong.approval_requested') phase = 'waiting'
                if (e.type === 'CUSTOM' && e.name === 'loong.approval_resolved') phase = 'tool'
                collected = fold(collected, e)
                const u = (e as unknown as { usage?: StreamUsage }).usage
                const view: SessionView = {
                  blocks: collected,
                  running: true,
                  phase,
                  error: null,
                  usage: u ?? null,
                }
                setViews((prev) => ({ ...prev, [id]: { ...view, usage: u ?? prev[id]?.usage ?? null } }))
              } catch {
                /* a frame that is not JSON is a comment or a keep-alive */
              }
            }
            cut = buffer.indexOf('\n\n')
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          /* stopped on purpose — not an error */
        } else if (stillMine()) {
          patch(id, { error: (err as Error).message })
        }
      } finally {
        /* only clear the slot if it is still THIS run's controller: a retry may
           have already replaced it, and deleting that one would make Stop mute */
        if (controllers.current[id] === ac) delete controllers.current[id]
        if (stillMine()) {
          patch(id, { running: false, phase: 'idle' })
          /* one write when the run settles, not one per token: a 5,000-block
             transcript rewritten on every delta is a disk-bound interface */
          void api.saveBlocks(id, collected).catch(() => {})
        }
      }
      return { completed: stillMine(), blocks: collected }
    },
    [patch],
  )

  const setBlocks = useCallback((id: string, blocks: Block[]) => {
    if (!alive.current) return
    setViews((prev) => {
      const base = prev[id] ?? EMPTY
      /* a loaded transcript is not a run: keep the live flags if one is in
         flight, because the disk copy is older than the stream */
      return { ...prev, [id]: { ...base, blocks } }
    })
  }, [])

  const clearError = useCallback((id?: string) => {
    if (!id) {
      setViews((prev) => {
        const next: Record<string, SessionView> = {}
        for (const [k, v] of Object.entries(prev)) next[k] = v.error ? { ...v, error: null } : v
        return next
      })
      return
    }
    setViews((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], error: null } } : prev))
  }, [])

  const view = (activeId ? views[activeId] : undefined) ?? EMPTY
  const slots = useMemo(() => Object.keys(views), [views])
  const runningIds = useMemo(
    () => Object.entries(views).filter(([, v]) => v.running).map(([id]) => id),
    [views],
  )
  const loaded = useCallback((id: string) => id in views, [views])

  return {
    view,
    slots,
    runningIds,
    loaded,
    run,
    stop,
    setBlocks,
    clearError,
    drop,
  }
}

/** the wire history a run needs: user turns and the agent's replies */
export function toHistory(blocks: Block[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  for (const b of blocks) {
    if (b.k === 'user') out.push({ role: 'user', content: b.text })
    else if (b.k === 'text' && !b.streaming) out.push({ role: 'assistant', content: b.text })
  }
  return out
}

/** the settings body the run endpoint wants */
export function runConfig(s: Settings) {
  return { provider: s.provider, model: s.model }
}

export { api }
