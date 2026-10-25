import type { ApprovalRequest, Audit, Plan, QuestionRequest } from './api'

/* ===========================================================================
   Events → blocks. This is the only place tokens fold into messages.

   The agent streams AG-UI events plus LOONG's own `loong.*` events. The
   transcript is not that raw stream: it is a list of blocks, each of which has
   an identity that survives a reload (they are what PUT /api/threads/:id/blocks
   persists). Folding here — once — keeps every component downstream simple.

   Two rules that matter:
   1. A tool call is ONE row while it runs and ONE row when it finishes. The
      count in the header is the number of tool rows, not the number of events.
   2. Nothing is invented. A block exists because an event created it.
   =========================================================================== */

export type Block =
  | { k: 'user'; id: string; text: string; at: number }
  | { k: 'text'; id: string; text: string; at: number; streaming?: boolean }
  | { k: 'thinking'; id: string; text: string; at: number; chars: number }
  | {
      k: 'tool'
      id: string
      tool: string
      wire: string
      title: string
      args?: string
      result?: string
      ok?: boolean
      ms?: number
      live: boolean
      at: number
    }
  | { k: 'plan'; id: string; plan: Plan; at: number }
  | { k: 'approval'; id: string; request: ApprovalRequest; at: number }
  | { k: 'question'; id: string; request: QuestionRequest; at: number }
  | { k: 'audit'; id: string; audit: Audit; at: number }
  | { k: 'check'; id: string; label: string; ok: boolean; at: number }
  | { k: 'screenshot'; id: string; path: string; tool: string; at: number }
  | { k: 'notice'; id: string; text: string; at: number }
  | { k: 'stop'; id: string; reason: string; text: string; model?: string; at: number }
  | { k: 'subagent'; id: string; scope: string; task: string; phase: string; detail?: string; at: number }
  | { k: 'failed'; id: string; cause: string; detail: string; model?: string; at: number }

/** the AG-UI events the interface consumes */
export interface AgentEvent {
  type: string
  delta?: string
  textMessageId?: string
  toolCallId?: string
  toolCallName?: string
  parentMessageId?: string | null
  rawInput?: unknown
  result?: string
  isError?: boolean
  step?: number
  message?: string
  code?: string
  name?: string
  value?: unknown
  runId?: string
  threadId?: string
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Fold one event into the block list. Returns a NEW list; the old one is never
 * mutated, because React compares by reference and the stream re-renders on
 * every delta.
 */
export function fold(blocks: Block[], e: AgentEvent): Block[] {
  const at = Date.now()
  const next = blocks.slice()

  switch (e.type) {
    case 'TEXT_MESSAGE_CONTENT': {
      const delta = e.delta ?? ''
      const last = next[next.length - 1]
      if (last && last.k === 'text' && last.streaming) {
        next[next.length - 1] = { ...last, text: last.text + delta }
        return next
      }
      next.push({ k: 'text', id: e.textMessageId ?? newId(), text: delta, at, streaming: true })
      return next
    }

    case 'TEXT_MESSAGE_END': {
      const last = next[next.length - 1]
      if (last && last.k === 'text') next[next.length - 1] = { ...last, streaming: false }
      return next
    }

    case 'THINKING_TEXT_MESSAGE_CONTENT':
    case 'THINKING_START': {
      const delta = e.delta ?? ''
      const last = next[next.length - 1]
      if (last && last.k === 'thinking') {
        next[next.length - 1] = {
          ...last,
          text: last.text + delta,
          chars: last.chars + delta.length,
        }
        return next
      }
      next.push({ k: 'thinking', id: newId(), text: delta, at, chars: delta.length })
      return next
    }

    case 'TOOL_CALL_START': {
      next.push({
        k: 'tool',
        id: e.toolCallId ?? newId(),
        tool: e.toolCallName ?? 'tool',
        wire: e.toolCallName ?? 'tool',
        title: e.toolCallName ?? 'tool',
        live: true,
        at,
      })
      return next
    }

    case 'TOOL_CALL_ARGS': {
      const id = e.toolCallId
      const i = next.findIndex((b) => b.k === 'tool' && b.id === id)
      if (i >= 0) {
        const b = next[i]
        if (b.k === 'tool') next[i] = { ...b, args: (b.args ?? '') + (e.delta ?? '') }
      }
      return next
    }

    case 'TOOL_CALL_RESULT': {
      const id = e.toolCallId
      const i = next.findIndex((b) => b.k === 'tool' && b.id === id)
      if (i >= 0) {
        const b = next[i]
        if (b.k === 'tool') {
          next[i] = {
            ...b,
            result: e.result ?? b.result,
            ok: e.isError === true ? false : true,
            live: false,
          }
        }
      }
      return next
    }

    case 'TOOL_CALL_END': {
      const i = next.findIndex((b) => b.k === 'tool' && b.id === e.toolCallId)
      if (i >= 0) {
        const b = next[i]
        if (b.k === 'tool') next[i] = { ...b, live: false }
      }
      return next
    }

    case 'STEP_STARTED':
      return next

    case 'RUN_ERROR': {
      const last = next[next.length - 1]
      if (last && last.k === 'failed') {
        /* replace the previous failure instead of stacking duplicates */
        next[next.length - 1] = {
          k: 'failed',
          id: last.id,
          cause: e.message ?? 'the run failed',
          detail: e.message ?? '',
          at,
        }
      } else {
        next.push({
          k: 'failed',
          id: newId(),
          cause: e.message ?? 'the run failed',
          detail: e.message ?? '',
          at,
        })
      }
      return next
    }

    default:
      break
  }

  /* ---- LOONG's own events ------------------------------------------------ */
  if (e.type !== 'CUSTOM' || typeof e.name !== 'string') return next
  const v = (e.value ?? {}) as Record<string, unknown>

  switch (e.name) {
    case 'loong.approval_requested': {
      const r = v as unknown as ApprovalRequest
      if (!r.id) return next
      const i = next.findIndex((b) => b.k === 'approval' && b.id === r.id)
      if (i >= 0) return next
      next.push({ k: 'approval', id: r.id, request: r, at })
      return next
    }
    case 'loong.approval_resolved': {
      const id = String(v.id ?? '')
      return next.filter((b) => !(b.k === 'approval' && b.id === id))
    }
    case 'loong.question': {
      const r = v as unknown as QuestionRequest
      if (!r.id) return next
      next.push({ k: 'question', id: r.id, request: r, at })
      return next
    }
    case 'loong.plan': {
      const p = v as unknown as Plan
      if (!p?.steps) return next
      const i = next.findIndex((b) => b.k === 'plan')
      if (i >= 0 && next[i].k === 'plan') next[i] = { ...next[i], plan: p }
      else next.push({ k: 'plan', id: newId(), plan: p, at })
      return next
    }
    case 'loong.audit': {
      const a = v as unknown as Audit
      next.push({ k: 'audit', id: newId(), audit: a, at })
      return next
    }
    case 'loong.checks': {
      const ok = Boolean(v.ok)
      const label = String(v.label ?? '')
      const text = String(v.text ?? '')
      if (!label && !text) return next
      next.push({ k: 'check', id: newId(), label: label || text, ok, at })
      return next
    }
    case 'loong.screenshot': {
      next.push({
        k: 'screenshot',
        id: newId(),
        path: String(v.path ?? ''),
        tool: String(v.tool ?? ''),
        at,
      })
      return next
    }
    case 'loong.subagent': {
      next.push({
        k: 'subagent',
        id: newId(),
        scope: String(v.scope ?? ''),
        task: String(v.task ?? ''),
        phase: String(v.phase ?? ''),
        detail: v.detail ? String(v.detail) : undefined,
        at,
      })
      return next
    }
    case 'loong.stop': {
      const reason = String(v.reason ?? '')
      const model = v.model ? String(v.model) : ''
      if (!reason) return next
      const word =
        reason === 'step-limit'
          ? 'Stopped at the step budget — the task needed more turns than this run allows. Send "continue", or split it into smaller pieces.'
          : reason === 'aborted'
            ? 'Stopped on request.'
            : 'The run finished.'
      next.push({ k: 'stop', id: newId(), reason, text: word, model, at })
      return next
    }
    case 'loong.notice':
    case 'loong.retry': {
      const text = String(v.text ?? v.detail ?? v.reason ?? '')
      if (!text) return next
      next.push({ k: 'notice', id: newId(), text, at })
      return next
    }
    case 'loong.tool_duration': {
      const id = String(v.id ?? '')
      const i = next.findIndex((b) => b.k === 'tool' && b.id === id)
      if (i >= 0) {
        const b = next[i]
        if (b.k === 'tool') next[i] = { ...b, ms: Number(v.ms ?? 0), live: false }
      }
      return next
    }
    case 'loong.run_failed': {
      const cause = String(v.cause ?? '')
      const last = next[next.length - 1]
      if (last && last.k === 'failed' && last.cause === cause) {
        /* same failure cause — replace, don't stack */
        next[next.length - 1] = {
          k: 'failed',
          id: last.id,
          cause,
          detail: String(v.detail ?? ''),
          model: v.model ? String(v.model) : undefined,
          at,
        }
      } else {
        next.push({
          k: 'failed',
          id: newId(),
          cause,
          detail: String(v.detail ?? ''),
          model: v.model ? String(v.model) : undefined,
          at,
        })
      }
      return next
    }
    default:
      return next
  }
}

/**
 * A provider that cannot emit real tool calls writes them into the message as
 * text — `[tool_calls] [{...}]`. It is a machine artefact, not prose, and it
 * used to fill the whole window. Split it out so the transcript can fold it.
 */
export function splitToolCalls(text: string): { prose: string; calls: string } {
  /* both shapes appear in the wild: "[tool_calls]" and "[[tool_calls]]" */
  const m = /\[\[?tool_calls\]?\]/i.exec(text)
  if (!m) return { prose: text, calls: '' }
  const i = m.index
  const prose = text.slice(0, i).trimEnd()
  const calls = text.slice(i + m[0].length).trim()
  return { prose, calls }
}

/** one line a tool row can show while it runs and after it finishes */
export function toolSummary(b: Extract<Block, { k: 'tool' }>): string {
  if (b.title && b.title !== b.tool) return b.title
  const arg = (() => {
    if (!b.args) return ''
    try {
      const parsed = JSON.parse(b.args) as Record<string, unknown>
      const first = Object.values(parsed).find((x) => typeof x === 'string' && x.length > 0)
      return typeof first === 'string' ? first : ''
    } catch {
      return ''
    }
  })()
  if (arg) return arg.length > 90 ? `${arg.slice(0, 89)}…` : arg
  return b.result ? (b.result.split('\n').find((l) => l.trim()) ?? '').slice(0, 90) : ''
}
