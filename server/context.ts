import type { HistoryTurn } from './agent.ts'

/* ---------------------------------------------------------------------------
   Context window management.

   A model with an 8k context that has been working for 30 turns will hit the
   limit and fail. Claude Code solves this by summarizing older turns into a
   compact paragraph. Loong does the same: when the outgoing history exceeds a
   character budget, the oldest turns (excluding the most recent N) are
   collapsed into a single summary block.

   This is a heuristic, not a token counter. Counting tokens requires the
   model's tokenizer, which we do not have for every provider. Character
   count is a rough proxy (1 token ≈ 4 chars for English), and the budget is
   set conservatively so the approximation never overshoots.
   --------------------------------------------------------------------------- */

/** conservative character budget for the outgoing conversation */
const MAX_CONTEXT_CHARS = 24_000
/** never compact the most recent N turns — the model needs them verbatim */
const PROTECTED_TURNS = 8
/** cap on a single tool result sent to the model — beyond this, reading the
 *  file or re-running the tool is cheaper than carrying 50k chars every turn.
 *  The UI transcript is untouched; only the model-facing copy is trimmed. */
const MAX_TOOL_OUTPUT = 4_000

/**
 * Compact a history so it fits within the character budget.
 *
 * Turns are split into [old, recent] where recent = the last PROTECTED_TURNS.
 * If old exceeds half the budget, it is collapsed into one summary turn.
 * Tool results in the old section are truncated to their first line, because
 * a 200-line grep output from 10 turns ago is dead weight.
 */
export function compactHistory(history: HistoryTurn[]): HistoryTurn[] {
  if (history.length <= PROTECTED_TURNS) return truncateToolOutputs(history)

  const totalChars = history.reduce((sum, t) => {
    return sum + t.content.length + JSON.stringify(t.toolCalls ?? []).length + JSON.stringify(t.toolResults ?? []).length
  }, 0)

  if (totalChars <= MAX_CONTEXT_CHARS) return truncateToolOutputs(history)

  const splitIdx = history.length - PROTECTED_TURNS
  const old = history.slice(0, splitIdx)
  const recent = history.slice(splitIdx)

  const summary = summarize(old)
  return truncateToolOutputs([summary, ...recent])
}

/**
 * The single biggest token sink in a coding agent is a giant tool result —
 * a full file dump or a 2k-line grep — re-sent on every turn. The model does
 * not need all of it in context; it can re-read the file. Cap each result so a
 * long session stays affordable, while the verbatim transcript the UI shows is
 * never touched.
 */
function truncateToolOutputs(history: HistoryTurn[]): HistoryTurn[] {
  return history.map((t) => {
    if (!t.toolResults?.length) return t
    let changed = false
    const toolResults = t.toolResults.map((r) => {
      if (typeof r.output === 'string' && r.output.length > MAX_TOOL_OUTPUT) {
        changed = true
        return {
          ...r,
          output:
            r.output.slice(0, MAX_TOOL_OUTPUT) +
            `\n… (output truncated to ${MAX_TOOL_OUTPUT} chars — read the file or re-run the tool to see the rest)`,
        }
      }
      return r
    })
    return changed ? { ...t, toolResults } : t
  })
}

/**
 * Collapse a list of turns into one summary user turn.
 *
 * The summary preserves what was done, not how it was said. Tool calls are
 * listed by name and a one-line result; prose is truncated to its first
 * sentence. This is what the model reads instead of the raw transcript.
 */
function summarize(turns: HistoryTurn[]): HistoryTurn {
  const parts: string[] = ['[Earlier conversation, summarized to fit the context window.]']

  for (const turn of turns) {
    if (turn.role === 'user') {
      const snippet = turn.content.slice(0, 200).trim()
      if (snippet) parts.push(`User asked: ${snippet}${turn.content.length > 200 ? '…' : ''}`)
      continue
    }
    if (turn.role === 'assistant') {
      const snippet = turn.content.slice(0, 200).trim()
      if (snippet) parts.push(`Assistant: ${snippet}${turn.content.length > 200 ? '…' : ''}`)
      for (const call of turn.toolCalls ?? []) {
        const inputStr = typeof call.input === 'string' ? call.input.slice(0, 100) : JSON.stringify(call.input).slice(0, 100)
        parts.push(`  Tool: ${call.toolName}(${inputStr})`)
      }
      continue
    }
    if (turn.role === 'tool') {
      for (const result of turn.toolResults ?? []) {
        const firstLine = result.output.split('\n')[0]?.slice(0, 150) ?? ''
        parts.push(`  → ${result.toolName}: ${firstLine}${result.ok ? '' : ' (failed)'}${result.output.length > 150 ? '…' : ''}`)
      }
    }
  }

  parts.push('[End of summary. The turns below are the recent, verbatim conversation.]')

  return {
    role: 'user',
    content: parts.join('\n'),
  }
}
