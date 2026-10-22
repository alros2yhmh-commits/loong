import type {
  AgentEvent,
  AgentPhase,
  ApprovalDecision,
  ApprovalRequest,
  ToolCall,
  ToolResult,
} from './contract'

/* ---------------------------------------------------------------------------
   Events in, blocks out.

   The thread is not a list of events. It is a list of blocks, and a block is
   what a human would call one thing: a message, a thought, a tool run, a
   failure. Consecutive tokens fold into the block they belong to. This is the
   only place in the app that knows how to do that folding.
   --------------------------------------------------------------------------- */

export type Block =
  | { k: 'user'; id: string; text: string; images?: string[] }
  | { k: 'thinking'; id: string; text: string; live: boolean }
  | { k: 'text'; id: string; text: string; live: boolean }
  | { k: 'tool'; call: ToolCall; result?: ToolResult; startedAt?: number; live?: boolean; durationMs?: number }
  | {
      k: 'approval'
      request: ApprovalRequest
      decision?: ApprovalDecision
    }
  | { k: 'notice'; id: string; text: string }
  | { k: 'plan'; id: string; plan: import('./contract').Plan }
  | { k: 'audit'; audit: import('./contract').Audit }
  | { k: 'question'; request: import('./contract').QuestionRequest; answer?: string | null }
  | {
      k: 'subagent'
      id: string
      scope: 'explore' | 'research'
      task: string
      phase: 'start' | 'end'
      at: number
    }
  | { k: 'screenshot'; id: string; path: string; at: number }
  | { k: 'error'; id: string; message: string; detail?: string }

export interface HistoryTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** images the reader pasted — data URLs the model can actually see */
  images?: string[]
  toolCalls?: {
    toolCallId: string
    toolName: string
    input: unknown
    providerOptions?: Record<string, unknown>
  }[]
  toolResults?: { toolCallId: string; toolName: string; output: string; ok: boolean }[]
}

/**
 * The conversation as the model must see it.
 *
 * Sending only prose is what made the agent amnesiac: from the second turn it
 * could not see a single tool call it had made. A tool block becomes a
 * `tool-call` on the assistant turn plus a `tool-result` on the turn after it —
 * the exact shape providers require.
 */
export function blocksToHistory(blocks: Block[]): HistoryTurn[] {
  const out: HistoryTurn[] = []
  for (const b of blocks) {
    if (b.k === 'user') {
      if (b.text.trim() || (b.images?.length ?? 0) > 0) {
        out.push({
          role: 'user',
          content: b.text,
          ...(b.images?.length ? { images: b.images } : {}),
        })
      }
      continue
    }
    if (b.k === 'text') {
      if (b.text.trim()) out.push({ role: 'assistant', content: b.text })
      continue
    }
    if (b.k === 'tool') {
      const name = b.call.wire ?? b.call.tool
      const call = { toolCallId: b.call.id, toolName: name, input: b.call.input }
      const last = out[out.length - 1]
      if (last && last.role === 'assistant') {
        last.toolCalls = [...(last.toolCalls ?? []), call]
      } else {
        out.push({ role: 'assistant', content: '', toolCalls: [call] })
      }
      if (b.result) {
        out.push({
          role: 'tool',
          content: '',
          toolResults: [
            {
              toolCallId: b.call.id,
              toolName: name,
              output: b.result.output,
              ok: b.result.ok,
            },
          ],
        })
      }
    }
  }
  return out
}

/** mark a question answered in the block list, so the card settles immediately */
export function answerQuestion(
  blocks: Block[],
  id: string,
  answer: string | null,
): Block[] {
  return blocks.map((b) =>
    b.k === 'question' && b.request.id === id ? { ...b, answer } : b,
  )
}

/** close every open block — used when a turn ends or a tool interrupts */
function settle(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.k === 'thinking' || b.k === 'text' ? { ...b, live: false } : b,
  )
}

export function reduce(blocks: Block[], e: AgentEvent): Block[] {
  switch (e.kind) {
    case 'session':
      return blocks

    case 'user':
      return [
        ...settle(blocks),
        {
          k: 'user',
          id: e.id,
          text: e.text,
          ...(e.images?.length ? { images: e.images } : {}),
        },
      ]

    case 'thinking':
      return [
        ...settle(blocks),
        { k: 'thinking', id: e.id, text: e.text, live: true },
      ]

    case 'token': {
      const last = blocks[blocks.length - 1]
      if (last && last.k === 'text' && last.id === e.id) {
        const next = blocks.slice(0, -1)
        next.push({ ...last, text: last.text + e.text })
        return next
      }
      return [
        ...settle(blocks),
        { k: 'text', id: e.id, text: e.text, live: true },
      ]
    }

    case 'message':
      return settle(blocks)

    case 'tool_call': {
      /* a tool the model already announced may send its real arguments later,
         in which case the card is updated rather than duplicated — and the
         original start time is kept, or the live timer would restart */
      const idx = blocks.findIndex((b) => b.k === 'tool' && b.call.id === e.call.id)
      if (idx !== -1) {
        const next = blocks.slice()
        const prev = next[idx] as Extract<Block, { k: 'tool' }>
        next[idx] = { ...prev, call: { ...e.call, live: true } }
        return next
      }
      return [
        ...settle(blocks),
        { k: 'tool', call: e.call, startedAt: e.at, live: true },
      ]
    }

    /* streamed arguments land on the card that is already on screen */
    case 'tool_args': {
      let hit = false
      const next = blocks.map((b) => {
        if (b.k !== 'tool' || b.call.id !== e.id) return b
        hit = true
        /* the first delta arrives on a card whose input is still empty, so the
           accumulator has to start from the delta itself, not from nothing */
        const raw = (b.call.input as { _raw?: unknown })._raw
        const acc = typeof raw === 'string' ? raw + e.delta : e.delta
        return {
          ...b,
          call: { ...b.call, input: { _raw: acc } },
        }
      })
      return hit ? next : blocks
    }

    case 'approval':
      return [...settle(blocks), { k: 'approval', request: e.request }]

    case 'tool_result': {
      const idx = blocks.findIndex(
        (b) => b.k === 'tool' && b.call.id === e.result.id,
      )
      if (idx === -1) return blocks
      const prev = blocks[idx] as Extract<Block, { k: 'tool' }>
      const next = blocks.slice()
      /* the duration event may have arrived before the result — if it did,
         the card shows the real number instead of the zero the result carries */
      next[idx] = {
        ...prev,
        result: { ...e.result, ms: prev.durationMs ?? e.result.ms },
      }
      return next
    }

    /* the tool measured itself: patch the card, and the timeline reads it */
    case 'tool_duration': {
      const next = blocks.map((b) => {
        if (b.k !== 'tool' || b.call.id !== e.id) return b
        return b.result
          ? { ...b, durationMs: e.ms, result: { ...b.result, ms: e.ms } }
          : { ...b, durationMs: e.ms }
      })
      return next
    }

    case 'notice':
      return [
        ...settle(blocks),
        { k: 'notice', id: e.id, text: e.text },
      ]

    case 'plan':
      /* keep only the newest plan at the end */
      return [...blocks.filter((b) => b.k !== 'plan'), { k: 'plan', id: e.id, plan: e.plan }]

    case 'audit':
      /* an audit is a result, not state — keep every one of them */
      return [...settle(blocks), { k: 'audit', audit: e.audit }]

    case 'question':
      return [...settle(blocks), { k: 'question', request: e.request }]

    case 'question_answered': {
      const next = blocks.map((b) =>
        b.k === 'question' && b.request.id === e.id
          ? { ...b, answer: e.answer }
          : b,
      )
      return next
    }

    case 'subagent': {
      /* one card per child: it opens when the work is delegated and settles
         when the summary comes back — the reader watches a run, not a log */
      const idx = blocks.findIndex(
        (b) => b.k === 'subagent' && b.task === e.task && b.phase === 'start',
      )
      if (e.phase === 'start') {
        if (idx !== -1) return blocks
        return [
          ...settle(blocks),
          {
            k: 'subagent',
            id: e.id,
            scope: e.scope,
            task: e.task,
            phase: 'start',
            at: e.at,
          },
        ]
      }
      if (idx === -1) return blocks
      const next = blocks.slice()
      next[idx] = { ...(next[idx] as Extract<Block, { k: 'subagent' }>), phase: 'end' }
      return next
    }

    case 'screenshot':
      return [...settle(blocks), { k: 'screenshot', id: e.id, path: e.path, at: e.at }]

    case 'error':
      return [
        ...settle(blocks),
        { k: 'error', id: e.id, message: e.message, detail: e.detail },
      ]

    case 'done':
      return settle(blocks)
    default:
      return blocks
  }
}

/** record a human decision against the open approval block */
export function decideApproval(
  blocks: Block[],
  id: string,
  decision: ApprovalDecision,
): Block[] {
  return blocks.map((b) =>
    b.k === 'approval' && b.request.id === id && !b.decision
      ? { ...b, decision }
      : b,
  )
}

/** the approval the agent is still waiting on, if any */
export function openApproval(blocks: Block[]): ApprovalRequest | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.k === 'approval' && !b.decision) return b.request
  }
  return null
}

/** what the interface shows in the status line, derived — never stored twice */
export function phaseOf(blocks: Block[], finished: boolean): AgentPhase {
  if (finished) return 'done'
  const last = blocks[blocks.length - 1]
  if (!last) return 'idle'
  if (last.k === 'error') return 'error'
  if (last.k === 'notice') return 'thinking'
  if (last.k === 'approval') return last.decision ? 'streaming' : 'awaiting'
  if (last.k === 'tool') return last.result ? 'streaming' : 'tool'
  if (last.k === 'subagent') return last.phase === 'start' ? 'tool' : 'streaming'
  if (last.k === 'screenshot') return 'streaming'
  if (last.k === 'audit') return 'done'
  if (last.k === 'thinking') return 'thinking'
  if (last.k === 'text') return 'streaming'
  return 'idle'
}

/**
 * Rebuild a thread from what the server stored.
 *
 * Only user turns and finished assistant replies are persisted — tool calls and
 * reasoning are live-only, because replaying them without their results would
 * show cards that can never resolve. A restored thread is therefore the
 * conversation, not the transcript, which is the honest thing to show.
 */
export function blocksFromHistory(
  rows: { role: 'user' | 'assistant' | 'tool'; content: string; id: number }[],
): Block[] {
  const out: Block[] = []
  for (const r of rows) {
    if (!r.content.trim()) continue
    if (r.role === 'user') out.push({ k: 'user', id: `h${r.id}`, text: r.content })
    else if (r.role === 'assistant')
      out.push({ k: 'text', id: `h${r.id}`, text: r.content, live: false })
  }
  return out
}

/* ---------------------------------------------------------------------------
   A block, verified.

   A snapshot is JSON that was written by an older build, or truncated by a
   crash, or hand-edited. Restoring it verbatim is how one malformed block
   takes the whole thread down — and with it the app. The render never sees a
   block that did not pass through here.
   --------------------------------------------------------------------------- */

export function isSaneBlock(b: unknown): b is Block {
  if (!b || typeof b !== 'object') return false
  const o = b as Record<string, unknown>
  switch (o.k) {
    case 'user':
      return typeof o.id === 'string' && typeof o.text === 'string'
    case 'thinking':
    case 'text':
      return typeof o.id === 'string' && typeof o.text === 'string'
    case 'notice':
      return typeof o.id === 'string' && typeof o.text === 'string'
    case 'plan':
      return typeof o.id === 'string' && !!o.plan && typeof o.plan === 'object'
    case 'tool': {
      const call = o.call as Record<string, unknown> | undefined
      return !!call && typeof call.id === 'string' && typeof call.name === 'string'
    }
    case 'approval': {
      const r = o.request as Record<string, unknown> | undefined
      return !!r && typeof r.id === 'string' && typeof r.title === 'string'
    }
    case 'question': {
      const r = o.request as Record<string, unknown> | undefined
      return !!r && typeof r.id === 'string' && typeof r.question === 'string'
    }
    case 'audit':
      return !!o.audit && typeof o.audit === 'object'
    case 'subagent':
      return typeof o.id === 'string' && typeof o.task === 'string'
    default:
      return false
  }
}

/** keep only the blocks that can be rendered; a snapshot is untrusted input */
export function saneBlocks(raw: unknown[]): Block[] {
  return raw.filter(isSaneBlock)
}
