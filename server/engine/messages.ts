import type { ModelMessage } from '@ai-sdk/provider-utils'

/* ---------------------------------------------------------------------------
   The conversation, in the shape a provider accepts.

   One place builds it: the kernel's loop, the fork path and the tests all send
   the same turns through the same function, so a message shape can never drift
   between two callers that must agree.
   --------------------------------------------------------------------------- */

export interface HistoryTurn {
  role: 'user' | 'assistant' | 'tool'
  /** the prose the model should read for this turn */
  content: string
  /** images the reader attached — data URLs or file paths the agent can read */
  images?: string[]
  /** tool calls made during an assistant turn */
  toolCalls?: {
    toolCallId: string
    toolName: string
    input: unknown
    /** provider-specific state (Gemini thought signatures, Anthropic cache) that
        must survive the round trip or the model loses its own reasoning */
    providerOptions?: Record<string, unknown>
  }[]
  /** results that came back, in the tool turn that follows. `image` carries a
      picture the tool produced (a screenshot, a diagram) as base64: the model
      has to receive it as a file part, never as base64 prose it cannot read. */
  toolResults?: {
    toolCallId: string
    toolName: string
    output: string
    ok: boolean
    image?: string
  }[]
}

/** the result a tool call gets when the run died before it returned.
 *
 *  A provider rejects a history that contains a tool call with no matching
 *  result — and it is right to: the model would be reading its own request
 *  with no answer. Closing a thread mid-tool is exactly how that history gets
 *  built, and the run then fails with "Tool result is missing for tool call
 *  X" — which reads as a bug in the app rather than what happened (the thread
 *  was closed while the tool was running).
 *
 *  So the gap is closed honestly: the call is answered with the truth. */
export const INTERRUPTED_RESULT =
  'Interrupted before this tool returned — the thread was closed or the run was stopped. Nothing was recorded; re-run it if it still matters.'

/** a tool result as the provider must see it: a picture is a file part */
export function toolResultOutput(result: { output: string; image?: string }): unknown {
  if (result.image) {
    return {
      type: 'content',
      value: [
        { type: 'file', mediaType: 'image/png', data: { type: 'data', data: result.image } },
      ],
    }
  }
  return { type: 'text', value: result.output || '(no output)' }
}

export function toModelMessages(history: HistoryTurn[]): ModelMessage[] {
  const out: ModelMessage[] = []
  /* every call id that a later tool turn answers */
  const answered = new Set<string>()
  for (const turn of history) {
    for (const r of turn.toolResults ?? []) if (r.toolCallId) answered.add(r.toolCallId)
  }
  /* calls that will never be answered get one synthetic result, at the end —
     the provider wants the answer in a tool message after the call, and the
     order of the answers does not matter, only their presence */
  const orphans: { toolCallId: string; toolName: string }[] = []

  for (const turn of history) {
    if (turn.role === 'user') {
      const images = turn.images ?? []
      if (images.length === 0) {
        if (turn.content.trim()) out.push({ role: 'user', content: turn.content })
      } else {
        /* a pasted screenshot or mockup rides along as parts, not as text */
        const parts: unknown[] = []
        if (turn.content.trim()) parts.push({ type: 'text', text: turn.content })
        for (const image of images) {
          parts.push({
            type: 'image',
            image: image.startsWith('data:') || image.startsWith('http')
              ? image
              : { type: 'file', data: image, mediaType: 'image/png' },
          })
        }
        out.push({ role: 'user', content: parts } as unknown as ModelMessage)
      }
      continue
    }

    if (turn.role === 'assistant') {
      const parts: unknown[] = []
      if (turn.content.trim()) {
        parts.push({ type: 'text', text: turn.content })
      }
      for (const call of turn.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input ?? {},
          ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}),
        })
        if (call.toolCallId && !answered.has(call.toolCallId)) {
          orphans.push({ toolCallId: call.toolCallId, toolName: call.toolName })
        }
      }
      if (parts.length > 0) {
        out.push({ role: 'assistant', content: parts } as unknown as ModelMessage)
      }
      continue
    }

    /* a tool turn: every result in one message, the way the SDK expects */
    const results = (turn.toolResults ?? [])
      .filter((r) => r.toolCallId)
      .map((r) => ({
        type: 'tool-result',
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        output: toolResultOutput(r),
        isError: !r.ok,
      }))
    if (results.length > 0) {
      out.push({
        role: 'tool',
        content: results,
      } as unknown as ModelMessage)
    }
  }

  if (orphans.length > 0) {
    out.push({
      role: 'tool',
      content: orphans.map((o) => ({
        type: 'tool-result',
        toolCallId: o.toolCallId,
        toolName: o.toolName,
        output: { type: 'text', value: INTERRUPTED_RESULT },
        isError: true,
      })),
    } as unknown as ModelMessage)
  }

  return out
}
