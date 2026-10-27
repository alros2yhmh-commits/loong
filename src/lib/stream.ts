import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, API_BASE, authHeaders, type Settings } from './api'
import { fold, toAgentHistory, type AgentEvent, type Block } from './blocks'

export interface RunResult { completed: boolean; blocks: Block[] }
export type RunPhase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting' | 'reconnecting'
export type StreamUsage = { promptTokens: number; completionTokens: number; model?: string }
export interface SessionView {
  blocks: Block[]
  running: boolean
  phase: RunPhase
  error: string | null
  usage: StreamUsage | null
  outcome: string | null
  connection: 'connected' | 'reconnecting' | 'offline'
  runId: string | null
  actualModel?: string
  runConfig?: { mode: 'ask' | 'plan' | 'agent'; trust: 'ask' | 'auto'; route: 'auto' | 'manual'; model: string; provider: string; workspace: string }
}
export interface RunBody {
  threadId: string; sessionId?: string
  messages: { role: string; content: string }[]
  settings: Settings
  capabilities?: Record<string, unknown>
  initialBlocks: Block[]
}
export interface StreamsHandle {
  view: SessionView; slots: string[]; runningIds: string[]
  loaded: (threadId: string) => boolean
  run: (body: RunBody) => Promise<RunResult>
  refresh: (threadId: string) => void
  stop: (threadId: string) => void
  setBlocks: (threadId: string, blocks: Block[]) => void
  clearError: (threadId?: string) => void
  drop: (threadId: string) => void
}
interface RecordView {
  id: string; threadId: string; status: string; settled: boolean; sequence: number
  actualModel?: string; selectedModel: string; provider: string; workspace: string
  mode: string; trust: string; route?: string; reason?: string
}
const EMPTY: SessionView = { blocks: [], running: false, phase: 'idle', error: null, usage: null,
  outcome: null, connection: 'connected', runId: null }
const endpoint = (path: string) => API_BASE + path

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(endpoint(path), {
    method: body === undefined ? 'GET' : 'POST', signal,
    headers: { ...authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw Object.assign(new Error(detail?.error ?? `${response.status} ${response.statusText}`), { status: response.status })
  }
  return response.json() as Promise<T>
}

/** Frame parsing is shared by POST compatibility clients and resumable GET subscriptions. */
export function parseFrames(buffer: string): { events: AgentEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: AgentEvent[] = []
  for (const frame of parts) {
    const data = frame.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') continue
    try { events.push(JSON.parse(data) as AgentEvent) } catch { /* comments/invalid frames carry no outcome */ }
  }
  return { events, rest }
}

export function useSessionStreams(activeId: string | null): StreamsHandle {
  const [views, setViews] = useState<Record<string, SessionView>>({})
  const latest = useRef<Record<string, SessionView>>({})
  const controllers = useRef<Record<string, AbortController>>({})
  const generations = useRef<Record<string, number>>({})
  const inspected = useRef(new Set<string>())
  const pendingStarts = useRef<Record<string, { signature: string; id: string }>>({})
  const alive = useRef(true)
  const patch = useCallback((id: string, update: Partial<SessionView>) => {
    if (!alive.current) return
    const next = { ...latest.current, [id]: { ...(latest.current[id] ?? EMPTY), ...update } }
    latest.current = next
    setViews(next)
  }, [])
  useEffect(() => { alive.current = true; return () => {
    alive.current = false
    // Closing a view only disconnects; cancellation is an explicit authenticated API command.
    Object.values(controllers.current).forEach((controller) => controller.abort())
  } }, [])

  const attach = useCallback(async (thread: string, record: RecordView, initial: Block[], generation: number): Promise<RunResult> => {
    controllers.current[thread]?.abort()
    const controller = new AbortController()
    controllers.current[thread] = controller
    const mine = () => alive.current && generations.current[thread] === generation && !controller.signal.aborted
    let blocks = initial
    let cursor = Math.max(0, ...initial.filter((b) => b.runId === record.id).map((b) => b.eventSequence ?? 0))
    let outcome: string | null = record.settled ? record.status : null
    let phase: RunPhase = 'thinking'
    patch(thread, { blocks, running: !record.settled, runId: record.id, outcome,
      connection: 'connected', actualModel: record.actualModel,
      runConfig: { mode: record.mode === 'ask' || record.mode === 'plan' ? record.mode : 'agent', trust: record.trust === 'auto' ? 'auto' : 'ask', route: record.route === 'auto' ? 'auto' : 'manual',
        model: record.selectedModel, provider: record.provider, workspace: record.workspace } })
    let retries = 0
    while (mine()) {
      try {
        const response = await fetch(endpoint(`/api/runs/${record.id}/events?after=${cursor}`), {
          headers: { ...authHeaders(), accept: 'text/event-stream' }, signal: controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`Cannot reconnect (${response.status}).`)
        patch(thread, { connection: 'connected', phase, error: null })
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done || !mine()) break
          const parsed = parseFrames(buffer + decoder.decode(chunk.value, { stream: true }))
          buffer = parsed.rest
          for (const event of parsed.events) {
            if (event.sequence && event.sequence <= cursor) continue
            if (event.sequence) cursor = event.sequence
            if (event.type === 'TEXT_MESSAGE_CONTENT') phase = 'streaming'
            if (event.type === 'TOOL_CALL_START') phase = 'tool'
            if (event.type === 'CUSTOM' && event.name === 'loong.approval_requested') phase = 'waiting'
            if (event.type === 'CUSTOM' && event.name === 'loong.approval_resolved') phase = 'tool'
            const result = (event.type === 'RUN_FINISHED' ? event.result : event.value) as Record<string, unknown> | undefined
            if ((event.type === 'RUN_FINISHED' || event.name === 'loong.outcome' || event.name === 'loong.settled') && result?.status) outcome = String(result.status)
            if (event.type === 'RUN_ERROR') outcome = 'failed'
            blocks = fold(blocks, event)
            const usage = event.type === 'RUN_FINISHED' && typeof event.result === 'object' ? event.result : undefined
            patch(thread, { blocks, phase, outcome, actualModel: typeof result?.model === 'string' ? result.model : latest.current[thread]?.actualModel,
              ...(usage ? { usage: { promptTokens: Number(usage.promptTokens ?? 0), completionTokens: Number(usage.completionTokens ?? 0), model: typeof usage.model === 'string' ? usage.model : undefined } } : {}) })
          }
        }
        if (!mine()) break
        const snapshot = await request<{ run: RecordView }>(`/api/runs/${record.id}`, controller.signal)
        if (snapshot.run.settled) {
          outcome = snapshot.run.status
          blocks = fold(blocks, { type: 'CUSTOM', name: 'loong.settled', runId: record.id, value: snapshot.run })
          patch(thread, { blocks, running: false, phase: 'idle', outcome, connection: 'connected',
            actualModel: snapshot.run.actualModel, error: null })
          void api.saveBlocks(thread, blocks).catch(() => {})
          break
        }
        throw new Error('The connection ended while the task is still running.')
      } catch (error) {
        if (!mine()) break
        retries += 1
        patch(thread, { running: true, phase: 'reconnecting', connection: retries < 5 ? 'reconnecting' : 'offline',
          error: 'Connection lost; the task may still be running. Reconnecting without repeating tools.' })
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, Math.min(5_000, 300 * 2 ** Math.min(retries, 4)))
          controller.signal.addEventListener('abort', done, { once: true })
        })
        void error
      }
    }
    if (controllers.current[thread] === controller) delete controllers.current[thread]
    return { completed: mine() && outcome === 'completed', blocks }
  }, [patch])

  const run = useCallback(async (body: RunBody): Promise<RunResult> => {
    const id = body.threadId
    const generation = (generations.current[id] = (generations.current[id] ?? 0) + 1)
    controllers.current[id]?.abort()
    patch(id, { blocks: body.initialBlocks, running: true, phase: 'thinking', error: null, outcome: null })
    try {
      // Save the user's turn before the background task can outlive this window.
      await api.saveBlocks(id, body.initialBlocks)
      const signature = JSON.stringify({ task: body.messages.at(-1)?.content, settings: body.settings })
      const pending = pendingStarts.current[id]?.signature === signature ? pendingStarts.current[id] : { signature, id: crypto.randomUUID() }
      pendingStarts.current[id] = pending
      const payload = {
        requestId: pending.id, threadId: id, sessionId: body.sessionId, messages: body.messages,
        history: toAgentHistory(body.initialBlocks), mode: body.settings.mode, trust: body.settings.trust,
        route: body.settings.route, config: { provider: body.settings.provider, model: body.settings.model },
        userName: body.settings.userName, capabilities: body.capabilities,
      }
      let accepted: { run: RecordView } | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        try { accepted = await request<{ run: RecordView }>('/api/runs/start', undefined, payload); break }
        catch (error) {
          if ((error as { status?: number }).status || attempt === 2) throw error
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
        }
      }
      if (!accepted) throw new Error('Task acceptance was not confirmed. Retry to reconnect safely.')
      const record = accepted.run
      delete pendingStarts.current[id]
      inspected.current.add(id)
      return attach(id, record, body.initialBlocks, generation)
    } catch (error) {
      inspected.current.delete(id)
      patch(id, { running: false, phase: 'idle', error: (error as Error).message, outcome: (error as { status?: number }).status ? 'failed' : null, connection: (error as { status?: number }).status ? 'connected' : 'offline' })
      return { completed: false, blocks: body.initialBlocks }
    }
  }, [attach, patch])

  useEffect(() => {
    if (!activeId || inspected.current.has(activeId) || latest.current[activeId]?.running) return
    const id = activeId
    inspected.current.add(id)
    void request<{ runs: RecordView[] }>(`/api/runs?threadId=${encodeURIComponent(id)}`).then(async ({ runs }) => {
      const record = runs[0]
      if (!record || !alive.current || latest.current[id]?.running) return
      const blocks = latest.current[id]?.blocks.length ? latest.current[id].blocks : await api.loadBlocks(id).catch(() => []) as Block[]
      const generation = (generations.current[id] = (generations.current[id] ?? 0) + 1)
      await attach(id, record, blocks, generation)
    }).catch(() => { inspected.current.delete(id) })
  }, [activeId, attach])

  const refresh = useCallback((id: string) => {
    const runId = latest.current[id]?.runId
    if (!runId || latest.current[id]?.running) return
    void request<{ run: RecordView }>(`/api/runs/${runId}`).then(({ run }) => {
      const generation = (generations.current[id] = (generations.current[id] ?? 0) + 1)
      return attach(id, run, latest.current[id]?.blocks ?? [], generation)
    }).catch((error) => patch(id, { error: (error as Error).message }))
  }, [attach, patch])

  const stop = useCallback((id: string) => {
    const runId = latest.current[id]?.runId
    if (!runId) return
    patch(id, { phase: 'waiting', error: null })
    void request(`/api/runs/${runId}/cancel`, undefined, {}).catch((error) => {
      patch(id, { error: `Cancellation was not confirmed: ${(error as Error).message}` })
    })
  }, [patch])
  const drop = useCallback((id: string) => {
    generations.current[id] = (generations.current[id] ?? 0) + 1
    controllers.current[id]?.abort()
    delete controllers.current[id]
    const next = { ...latest.current }; delete next[id]; latest.current = next; setViews(next)
    inspected.current.delete(id)
  }, [])
  const setBlocks = useCallback((id: string, blocks: Block[]) => {
    if (!latest.current[id]?.running) patch(id, { blocks })
  }, [patch])
  const clearError = useCallback((id?: string) => {
    if (id) patch(id, { error: null })
    else Object.keys(latest.current).forEach((key) => patch(key, { error: null }))
  }, [patch])
  const slots = useMemo(() => Object.keys(views), [views])
  const runningIds = useMemo(() => Object.entries(views).filter(([, view]) => view.running).map(([id]) => id), [views])
  const loaded = useCallback((id: string) => id in latest.current, [])
  return { view: activeId ? views[activeId] ?? EMPTY : EMPTY, slots, runningIds, loaded, run, refresh, stop, setBlocks, clearError, drop }
}

export function toHistory(blocks: Block[]): { role: string; content: string }[] {
  return blocks.flatMap((block) => block.k === 'user' ? [{ role: 'user', content: block.text }]
    : block.k === 'text' && !block.streaming ? [{ role: 'assistant', content: block.text }] : [])
}
export function runConfig(settings: Settings) { return { provider: settings.provider, model: settings.model } }
export { api }
