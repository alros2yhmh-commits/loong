import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Settings, type Usage } from './api'
import { fold, type AgentEvent, type Block } from './blocks'

/* ===========================================================================
   The one place the interface consumes a stream.

   EventSource cannot POST, and the run needs a body — so this is a hand-rolled
   reader over fetch: it opens the stream, splits on the SSE frame boundary, and
   folds each event into the block list. One timer in flight; StrictMode
   double-mounts effects, and two readers on one run is how a transcript gets
   every message twice.
   =========================================================================== */

export interface RunHandle {
  blocks: Block[]
  running: boolean
  phase: 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting'
  error: string | null
  usage: Usage | null
  /** start a run; the messages are the conversation in wire form */
  run: (body: {
    threadId: string
    sessionId?: string
    messages: { role: string; content: string }[]
    settings: Settings
    capabilities?: Record<string, unknown>
  }) => Promise<void>
  stop: () => void
  /** set the blocks without a run — restoring a saved transcript */
  setBlocks: (b: Block[]) => void
  clearError: () => void
}

export function useAgentStream(): RunHandle {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<RunHandle['phase']>('idle')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const abort = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setRunning(false)
    setPhase('idle')
  }, [])

  const run = useCallback(
    async (body: {
      threadId: string
      sessionId?: string
      messages: { role: string; content: string }[]
      settings: Settings
      capabilities?: Record<string, unknown>
    }) => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      setRunning(true)
      setPhase('thinking')
      setError(null)

      try {
        const res = await fetch('http://127.0.0.1:5274/api/agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            threadId: body.threadId,
            sessionId: body.sessionId,
            messages: body.messages,
            mode: body.settings.mode,
            trust: body.settings.trust,
            config: { provider: body.settings.provider, model: body.settings.model },
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
          buffer += decoder.decode(value, { stream: true })

          /* an SSE frame ends with a blank line */
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
                if (e.type === 'TEXT_MESSAGE_CONTENT') setPhase('streaming')
                if (e.type === 'TOOL_CALL_START') setPhase('tool')
                if (e.type === 'CUSTOM' && e.name === 'loong.approval_requested') setPhase('waiting')
                if (e.type === 'CUSTOM' && e.name === 'loong.approval_resolved') setPhase('tool')
                setBlocks((prev) => fold(prev, e))
                const u = (e as unknown as { usage?: Usage }).usage
                if (u) setUsage(u)
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
        } else {
          setError((err as Error).message)
        }
      } finally {
        setRunning(false)
        setPhase('idle')
        abort.current = null
      }
    },
    [],
  )

  useEffect(() => () => abort.current?.abort(), [])

  return {
    blocks,
    running,
    phase,
    error,
    usage,
    run,
    stop,
    setBlocks,
    clearError: () => setError(null),
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
