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

export type Block = (
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
  | { k: 'check'; id: string; label: string; ok: boolean; at: number; command?: string; output?: string; exitCode?: number; seconds?: number }
  | { k: 'screenshot'; id: string; path: string; tool: string; at: number }
  | { k: 'notice'; id: string; text: string; at: number }
  | { k: 'stop'; id: string; reason: string; text: string; model?: string; at: number }
  | { k: 'subagent'; id: string; scope: string; task: string; phase: string; detail?: string; at: number }
  | { k: 'failed'; id: string; cause: string; detail: string; model?: string; at: number }
  /* the execution cycle: one row per run, updated in place as phases move */
  | {
      k: 'cycle'
      id: string
      phase: string
      from: string
      reason: string
      step: number
      reads: number
      writes: number
      checks: number
      failures: number
      at: number
    }
  /* what the graph indexed — a small, factual card */
  | {
      k: 'graph'
      id: string
      files: number
      sourceFiles: number
      symbols: number
      edges: number
      cycles: number
      languages: { lang: string; count: number }[]
      at: number
    }
  /* one security finding, with the CWE page that explains it */
  | {
      k: 'finding'
      id: string
      severity: string
      rule: string
      file: string
      line: number
      snippet: string
      kb: string | null
      at: number
    }
  /* the ledger counts after a scan */
  | { k: 'findings'; id: string; open: number; critical: number; added: number; revived: number; at: number }
  | { k: 'outcome'; id: string; status: string; reason?: string; model?: string; at: number }
) & { runId?: string; eventSequence?: number }

/** the AG-UI events the interface consumes */
export interface AgentEvent {
  type: string
  delta?: string
  textMessageId?: string
  toolCallId?: string
  toolCallName?: string
  parentMessageId?: string | null
  rawInput?: unknown
  result?: string | Record<string, unknown>
  content?: string
  messageId?: string
  sequence?: number
  timestamp?: number
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
  if (e.sequence && e.runId && blocks.some((b) => b.runId === e.runId && (b.eventSequence ?? 0) >= e.sequence!)) return blocks
  const next = foldEvent(blocks, e)
  if (!e.runId || !e.sequence) return next
  return next.map((b) => blocks.includes(b) ? b : { ...b, runId: e.runId, eventSequence: e.sequence })
}

function foldEvent(blocks: Block[], e: AgentEvent): Block[] {
  const at = e.timestamp ?? Date.now()
  const next = blocks.slice()

  switch (e.type) {
    case 'TEXT_MESSAGE_CONTENT': {
      const delta = e.delta ?? ''
      const last = next[next.length - 1]
      if (last && last.k === 'text' && last.streaming) {
        next[next.length - 1] = { ...last, text: last.text + delta }
        return next
      }
      next.push({ k: 'text', id: e.textMessageId ?? e.messageId ?? newId(), text: delta, at, streaming: true })
      return next
    }

    case 'TEXT_MESSAGE_END': {
      const last = next[next.length - 1]
      if (last && last.k === 'text') next[next.length - 1] = { ...last, streaming: false }
      return next
    }

    case 'REASONING_MESSAGE_CONTENT': {
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
    /* markers only — the content arrives through REASONING_MESSAGE_CONTENT */
    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
    case 'REASONING_MESSAGE_END':
    case 'REASONING_END':
      return next

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
            result: typeof e.content === 'string' ? e.content : typeof e.result === 'string' ? e.result : b.result,
            /* the kernel says isError; a transcript stored before that field
               existed is judged by what the tool actually said */
            ok:
              e.isError === true
                ? false
                : !/^(?:Tool failed|Refused:|Could not |Browser failed|Request failed)/.test(
                    String(e.content ?? e.result ?? ''),
                  ),
            live: false,
          }
        }
      }
      return next
    }

    case 'TOOL_CALL_END':
      // This marks the end of argument streaming; execution ends on RESULT.
      return next

    case 'STEP_STARTED':
      return next

    case 'RUN_ERROR':
      /* RUN_ERROR is always followed by loong.run_failed, which creates the
         actual failed block with structured data (cause, detail, model).
         Creating a block here would produce a duplicate. */
      return next

    default:
      break
  }

  /* ---- LOONG's own events ------------------------------------------------ */
  if (e.type !== 'CUSTOM' || typeof e.name !== 'string') return next
  const v = (e.value ?? {}) as Record<string, unknown>

  switch (e.name) {
    case 'loong.rewound': {
      next.push({ k: 'notice', id: `rewind-${e.runId ?? v.runId}`, text: 'Changes rewound; previous checks describe the earlier file revision. Conflicting user changes were preserved.', at })
      return next
    }
    case 'loong.run': {
      const task = String(v.task ?? '')
      const last = [...next].reverse().find((b) => b.k === 'user')
      if (task && (!last || last.k !== 'user' || last.text !== task)) next.push({ k: 'user', id: `user-${e.runId}`, text: task, at })
      return next
    }
    case 'loong.outcome':
    case 'loong.settled': {
      const status = String(v.status ?? '')
      if (!status || status === 'running') return next
      if (e.name === 'loong.settled') {
        for (let i = 0; i < next.length; i++) {
          const block = next[i]
          if (block.k === 'tool' && block.live && (!block.runId || block.runId === e.runId)) next[i] = { ...block, live: false, ok: false, result: block.result ?? 'Interrupted: this call has no recorded result. Inspect its possible effects before retrying.' }
        }
      }
      const id = `outcome-${e.runId ?? 'run'}`
      const row: Block = { k: 'outcome', id, status, reason: typeof v.reason === 'string' ? v.reason : undefined,
        model: String(v.model ?? v.actualModel ?? '') || undefined, at }
      const index = next.findIndex((b) => b.id === id)
      if (index >= 0) next[index] = row
      else next.push(row)
      return next
    }
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
      next.push({ k: 'check', id: newId(), label: label || text, ok, at, command: typeof v.command === 'string' ? v.command : undefined, output: typeof v.output === 'string' ? v.output : undefined, exitCode: typeof v.exitCode === 'number' ? v.exitCode : undefined, seconds: typeof v.seconds === 'number' ? v.seconds : undefined })
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
            : reason === 'stopped-short'
              ? `The run ended with ${Number(v.openSteps ?? 0) || 'some'} plan step(s) still open and nothing changed. Send "continue" to do the work.`
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
    /* ---- the cycle, the graph and the findings -------------------------- */
    case 'loong.cycle': {
      const phase = String(v.phase ?? '')
      if (!phase) return next
      const row = {
        k: 'cycle' as const,
        id: newId(),
        phase,
        from: String(v.from ?? ''),
        reason: String(v.reason ?? ''),
        step: Number(v.step ?? 0),
        reads: Number(v.reads ?? 0),
        writes: Number(v.writes ?? 0),
        checks: Number(v.checks ?? 0),
        failures: Number(v.failures ?? 0),
        at,
      }
      /* a new run starts at intake — that is a new row. A step inside the same
         run updates the row in place, so the transcript shows one cycle card,
         not six. */
      if (phase === 'intake') {
        next.push(row)
        return next
      }
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i]
        if (b.k === 'cycle') {
          next[i] = { ...row, id: b.id }
          return next
        }
      }
      next.push(row)
      return next
    }
    case 'loong.graph': {
      const files = Number(v.files ?? 0)
      if (!files) return next
      const row = {
        k: 'graph' as const,
        id: newId(),
        files,
        sourceFiles: Number(v.sourceFiles ?? 0),
        symbols: Number(v.symbols ?? 0),
        edges: Number(v.edges ?? 0),
        cycles: Number(v.cycles ?? 0),
        languages: Array.isArray(v.languages)
          ? (v.languages as { lang?: unknown; count?: unknown }[])
              .filter((l) => typeof l?.lang === 'string')
              .map((l) => ({ lang: String(l.lang), count: Number(l.count ?? 0) }))
          : [],
        at,
      }
      const last = next[next.length - 1]
      if (last && last.k === 'graph') {
        next[next.length - 1] = { ...row, id: last.id }
        return next
      }
      next.push(row)
      return next
    }
    case 'loong.finding': {
      const rule = String(v.rule ?? '')
      const file = String(v.file ?? '')
      if (!rule) return next
      /* one row per rule+file: a second report of the same issue updates the
         line and snippet instead of stacking a duplicate card */
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i]
        if (b.k === 'finding' && b.rule === rule && b.file === file) {
          next[i] = {
            ...b,
            severity: String(v.severity ?? b.severity),
            line: Number(v.line ?? b.line),
            snippet: String(v.snippet ?? b.snippet),
            kb: v.kb ? String(v.kb) : b.kb,
            at,
          }
          return next
        }
        /* only look inside this run's tail — an old run's finding is history */
        if (b.k === 'cycle' || b.k === 'user') break
      }
      next.push({
        k: 'finding',
        id: newId(),
        severity: String(v.severity ?? 'medium'),
        rule,
        file,
        line: Number(v.line ?? 0),
        snippet: String(v.snippet ?? ''),
        kb: v.kb ? String(v.kb) : null,
        at,
      })
      return next
    }
    case 'loong.findings': {
      next.push({
        k: 'findings',
        id: newId(),
        open: Number(v.open ?? 0),
        critical: Number(v.critical ?? 0),
        added: Number(v.added ?? 0),
        revived: Number(v.revived ?? 0),
        at,
      })
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
      /* A run can emit the same failure more than once — once per retry attempt,
         or once as a transient notice and once as the structured failure. Collapse
         every failure that shares a cause into ONE block, even when other blocks
         (a notice, a retry, a fresh tool call) sit between them. The transcript
         shows a single failed card, never a stack of identical ones. */
      let replaceAt = -1
      for (let i = next.length - 1; i >= 0; i--) {
        const b = next[i]
        if (b.k !== 'failed') continue
        if (b.cause === cause || (cause === '' && b.cause === '')) {
          replaceAt = i
          break
        }
        /* a newer failure with a DIFFERENT cause means this cause is genuinely
           separate, so stop looking and append a new card */
        break
      }
      if (replaceAt >= 0) {
        const id = next[replaceAt].id
        next[replaceAt] = {
          k: 'failed',
          id,
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

/** the conversation the model should see — including tool calls and results */
export type AgentHistoryTurn = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: { toolCallId: string; toolName: string; input: unknown }[]
  toolResults?: { toolCallId: string; toolName: string; output: string; ok: boolean }[]
}

const INTERRUPTED =
  'Interrupted before this tool returned — the thread was closed or the run was stopped. Nothing was recorded; re-run it if it still matters.'

function parseArgs(raw?: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { raw }
  }
}

/**
 * Rebuild the model's history from transcript blocks. User turns, assistant
 * prose, and real tool rows all survive. Thinking, notices and UI chrome do not.
 */
export function toAgentHistory(blocks: Block[]): AgentHistoryTurn[] {
  const out: AgentHistoryTurn[] = []
  const pending: Extract<Block, { k: 'tool' }>[] = []

  const flushTools = () => {
    if (pending.length === 0) return
    const group = pending.splice(0, pending.length)
    out.push({
      role: 'assistant',
      content: '',
      toolCalls: group.map((t) => ({
        toolCallId: t.id,
        toolName: t.tool,
        input: parseArgs(t.args),
      })),
    })
    out.push({
      role: 'tool',
      content: '',
      toolResults: group.map((t) => ({
        toolCallId: t.id,
        toolName: t.tool,
        output: t.live ? INTERRUPTED : (t.result ?? ''),
        ok: t.live ? false : t.ok !== false,
      })),
    })
  }

  for (const b of blocks) {
    if (b.k === 'user') {
      flushTools()
      if (b.text.trim()) out.push({ role: 'user', content: b.text })
    } else if (b.k === 'text') {
      flushTools()
      if (b.text.trim()) out.push({ role: 'assistant', content: b.text })
    } else if (b.k === 'tool') {
      pending.push(b)
    }
  }
  flushTools()
  return out
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
