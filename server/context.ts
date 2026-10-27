import type { HistoryTurn } from './engine/messages.ts'

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

/** the second tier: past this the old tool results are cleared in place,
 *  before the whole old section is worth summarizing. Full summarization
 *  loses the shape of the conversation; clearing a stale grep result does
 *  not — it only removes an answer the model can fetch again.
 *  Exported so the run can fire PreCompact/PostCompact only when there is
 *  actually work to do. */
export const COMPACT_HINT_CHARS = 12_000
/** how many of the newest tool results are never cleared */
const KEEP_RECENT_TOOL_RESULTS = 6
const CLEARED_MARK = '[cleared to keep the context small'

/** the size the model would pay for, by the same rough proxy the budget uses */
export function contextChars(history: HistoryTurn[]): number {
  return history.reduce((sum, t) => {
    return sum + t.content.length + JSON.stringify(t.toolCalls ?? []).length + JSON.stringify(t.toolResults ?? []).length
  }, 0)
}

/**
 * Compact a history so it fits within the character budget.
 *
 * Turns are split into [old, recent] where recent = the last PROTECTED_TURNS.
 * If old exceeds half the budget, it is collapsed into one summary turn.
 * Tool results in the old section are truncated to their first line, because
 * a 200-line grep output from 10 turns ago is dead weight.
 */
export interface ContextBudget { maxChars?: number; aggressive?: boolean }
export function compactHistory(history: HistoryTurn[], budget: ContextBudget = {}): HistoryTurn[] {
  const limit = Math.max(4_000, budget.maxChars ?? MAX_CONTEXT_CHARS)
  const hint = Math.min(COMPACT_HINT_CHARS, Math.floor(limit / 2))
  const protectedTurns = budget.aggressive ? 4 : PROTECTED_TURNS
  const clipped = truncateToolOutputs(history)
  if (contextChars(clipped) <= hint) return clipped

  /* tier 1: old tool results are answers the model can ask for again. The
     newest few stay verbatim — they are what the current turn is built on. */
  const micro = microcompact(clipped)
  if (contextChars(micro) <= limit && !budget.aggressive) return micro

  /* tier 2: still too large — collapse the old section into one summary */
  if (micro.length <= protectedTurns) return micro
  let splitIdx = micro.length - protectedTurns
  // Never start the recent tail at a result whose assistant call was summarized.
  if (micro[splitIdx]?.role === 'tool' && micro[splitIdx - 1]?.toolCalls?.length) splitIdx -= 1
  const old = micro.slice(0, splitIdx)
  const recent = micro.slice(splitIdx)

  const summary = summarize(old)
  const firstRequest = history.find((turn) => turn.role === 'user' && !turn.content.startsWith('[Earlier conversation'))
  const latestRequest = [...old].reverse().find((turn) => turn.role === 'user' && turn !== firstRequest && !turn.content.startsWith('[Earlier conversation'))
  const requirements = [firstRequest, latestRequest].filter((turn): turn is HistoryTurn => Boolean(turn))
  if (requirements.length) {
    summary.content += '\n\n[User requirements retained verbatim; do not drop these constraints.]\n' +
      requirements.map((turn) => turn.content).join('\n\n')
  }
  return truncateToolOutputs([summary, ...recent])
}

/**
 * Clear the oldest tool results, keeping the newest KEEP_RECENT_TOOL_RESULTS
 * intact. The replacement says what was lost and how to get it back, so the
 * model does not read the gap as "the tool returned nothing".
 */
function microcompact(history: HistoryTurn[]): HistoryTurn[] {
  let keep = KEEP_RECENT_TOOL_RESULTS
  const out = [...history]
  for (let i = out.length - 1; i >= 0; i--) {
    const results = out[i].toolResults
    if (!results?.length) continue
    let changed = false
    const next = [...results]
    for (let j = next.length - 1; j >= 0; j--) {
      if (keep > 0) {
        keep -= 1
        continue
      }
      const r = next[j]
      if (r.output.startsWith(CLEARED_MARK)) continue
      changed = true
      next[j] = {
        ...r,
        output: `${CLEARED_MARK} — ${r.output.length} chars; re-read the file or re-run the tool if it still matters]`,
      }
    }
    if (changed) out[i] = { ...out[i], toolResults: next }
  }
  return out
}

/**
 * The single biggest token sink in a coding agent is a giant tool result —
 * a full file dump or a 2k-line grep — re-sent on every turn. The model does
 * not need all of it in context; it can re-read the file. Cap each result so a
 * long session stays affordable, while the verbatim transcript the UI shows is
 * never touched.
 *
 * The cap keeps the HEAD AND THE TAIL. A head-only cut is wrong for exactly
 * the results that matter: a failing test's answer is its last line, and a
 * build error's last frame is the cause. Dropping the tail throws away the
 * part the model reads twice.
 */
function clipToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT) return output
  const head = Math.floor(MAX_TOOL_OUTPUT * 0.7)
  const tail = MAX_TOOL_OUTPUT - head - 90
  const omitted = output.length - head - tail
  return (
    output.slice(0, head) +
    `\n… (${omitted} chars omitted — the tail is kept because it holds the answer) …\n` +
    output.slice(output.length - tail)
  )
}

function truncateToolOutputs(history: HistoryTurn[]): HistoryTurn[] {
  return history.map((t) => {
    if (!t.toolResults?.length) return t
    let changed = false
    const toolResults = t.toolResults.map((r) => {
      if (typeof r.output === 'string' && r.output.length > MAX_TOOL_OUTPUT) {
        changed = true
        return { ...r, output: clipToolOutput(r.output) }
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
/** a summary that grows without a cap is a second context problem: a hundred
 *  old turns would produce a summary bigger than the turns it replaced. The
 *  oldest detail is dropped first — it is the least relevant to the next turn. */
const MAX_SUMMARY_CHARS = 6_000

function summarize(turns: HistoryTurn[]): HistoryTurn {
  const parts: string[] = ['[Earlier conversation, summarized to fit the context window. Most recent work first; original requirements retained below.]']
  let spent = 0
  let dropped = 0
  const push = (line: string) => {
    if (spent + line.length > MAX_SUMMARY_CHARS) {
      dropped += 1
      return
    }
    spent += line.length
    parts.push(line)
  }

  for (const turn of [...turns].reverse()) {
    if (turn.role === 'user') {
      const snippet = turn.content.slice(0, 200).trim()
      if (snippet) push(`User asked: ${snippet}${turn.content.length > 200 ? '…' : ''}`)
      continue
    }
    if (turn.role === 'assistant') {
      const snippet = turn.content.slice(0, 200).trim()
      if (snippet) push(`Assistant: ${snippet}${turn.content.length > 200 ? '…' : ''}`)
      for (const call of turn.toolCalls ?? []) {
        const inputStr = typeof call.input === 'string' ? call.input.slice(0, 100) : JSON.stringify(call.input).slice(0, 100)
        push(`  Tool: ${call.toolName}(${inputStr})`)
      }
      continue
    }
    if (turn.role === 'tool') {
      for (const result of turn.toolResults ?? []) {
        const firstLine = (result.ok ? result.output.split('\n')[0] : result.output.slice(-700))?.slice(0, 700) ?? ''
        push(`  → ${result.toolName}: ${firstLine}${result.ok ? '' : ' (failed)'}${result.output.length > 150 ? '…' : ''}`)
      }
    }
  }
  if (dropped > 0) {
    parts.push(`[${dropped} older detail lines dropped from this summary — the recent turns below are verbatim.]`)
  }

  parts.push('[End of summary. The turns below are the recent, verbatim conversation.]')

  return {
    role: 'user',
    content: parts.join('\n'),
  }
}
