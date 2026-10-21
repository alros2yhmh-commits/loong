import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   Traces — the run, measured.

   Langfuse is the reference for what a trace is: a run with its spans, tokens
   and outcome, so a bad week can be read as data instead of remembered as a
   feeling. It is also a cloud service, and this app is local-first. So the
   store here is local JSONL — the same shape, one line per run — and an
   exporter can ship it to Langfuse later without the app depending on it.

   What is recorded is what is already known: the model, the steps, every tool
   span with its milliseconds, the token counts, and how the run ended. Nothing
   is invented and nothing is sampled — the numbers come from the same events
   the interface sees.
   --------------------------------------------------------------------------- */

export interface TraceSpan {
  tool: string
  ms: number
}

export interface RunTrace {
  runId: string
  threadId: string
  at: number
  endedAt: number
  model: string
  steps: number
  tools: TraceSpan[]
  promptTokens: number
  completionTokens: number
  /** the wall-clock time of the run, derived from at/endedAt */
  ms: number
  outcome: 'ok' | 'error' | 'aborted'
  error?: string
}

interface Live {
  runId: string
  threadId: string
  at: number
  model: string
  steps: number
  tools: TraceSpan[]
}

const live = new Map<string, Live>()

/** keep the file bounded; a trace log is not an archive */
const MAX_BYTES = 4 * 1024 * 1024
const KEEP_ON_COMPACT = 1_000

function traceFile(): string {
  return join(DATA_DIR, 'traces.jsonl')
}

export function beginTrace(runId: string, threadId: string, model: string): void {
  live.set(runId, { runId, threadId, at: Date.now(), model, steps: 0, tools: [] })
}

export function noteStep(runId: string): void {
  const t = live.get(runId)
  if (t) t.steps += 1
}

export function recordToolSpan(runId: string, tool: string, ms: number): void {
  const t = live.get(runId)
  if (t) t.tools.push({ tool, ms: Math.max(0, Math.round(ms)) })
}

export function endTrace(
  runId: string,
  patch: {
    promptTokens?: number
    completionTokens?: number
    outcome: RunTrace['outcome']
    error?: string
  },
): RunTrace | null {
  const t = live.get(runId)
  if (!t) return null
  live.delete(runId)
  const endedAt = Date.now()
  const record: RunTrace = {
    ...t,
    endedAt,
    ms: endedAt - t.at,
    promptTokens: patch.promptTokens ?? 0,
    completionTokens: patch.completionTokens ?? 0,
    outcome: patch.outcome,
    ...(patch.error ? { error: patch.error.slice(0, 500) } : {}),
  }
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    const file = traceFile()
    /* compact before appending, so the file never grows without a ceiling */
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      const kept = readLines(file).slice(-KEEP_ON_COMPACT)
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
      renameSync(tmp, file)
    }
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    /* a trace that cannot be written must never fail the run */
  }
  return record
}

function readLines(file: string): RunTrace[] {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as RunTrace
        } catch {
          return null
        }
      })
      .filter((t): t is RunTrace => t !== null && typeof t.runId === 'string')
  } catch {
    return []
  }
}

/** the most recent runs, newest first */
export function listTraces(limit = 50): RunTrace[] {
  const file = traceFile()
  if (!existsSync(file)) return []
  return readLines(file).slice(-limit).reverse()
}

export function traceFor(runId: string): RunTrace | null {
  return readLines(traceFile()).find((t) => t.runId === runId) ?? null
}

/** aggregates for the measurement the plan asks for */
export interface TraceStats {
  runs: number
  ok: number
  errors: number
  aborted: number
  avgMs: number
  avgPromptTokens: number
  avgCompletionTokens: number
  /** the slowest tools across the window, by total time */
  slowest: { tool: string; totalMs: number; calls: number }[]
}

export function traceStats(limit = 100): TraceStats {
  const rows = listTraces(limit)
  const byTool = new Map<string, { totalMs: number; calls: number }>()
  let totalMs = 0
  let prompt = 0
  let completion = 0
  let ok = 0
  let errors = 0
  let aborted = 0
  for (const r of rows) {
    totalMs += r.ms
    prompt += r.promptTokens
    completion += r.completionTokens
    if (r.outcome === 'ok') ok += 1
    else if (r.outcome === 'error') errors += 1
    else aborted += 1
    for (const s of r.tools) {
      const row = byTool.get(s.tool) ?? { totalMs: 0, calls: 0 }
      row.totalMs += s.ms
      row.calls += 1
      byTool.set(s.tool, row)
    }
  }
  const n = rows.length || 1
  return {
    runs: rows.length,
    ok,
    errors,
    aborted,
    avgMs: Math.round(totalMs / n),
    avgPromptTokens: Math.round(prompt / n),
    avgCompletionTokens: Math.round(completion / n),
    slowest: [...byTool.entries()]
      .map(([tool, v]) => ({ tool, totalMs: v.totalMs, calls: v.calls }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 8),
  }
}
