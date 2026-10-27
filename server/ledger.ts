import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'
import { mergeDeliveries, type Delivery } from './deliveries.ts'
import type { Plan } from './tools.ts'

/* ---------------------------------------------------------------------------
   The state a run leaves behind.

   The digest keeps what was said. This keeps what was DONE: the plan, which
   steps are still open, the files that changed, and whether the checks passed.
   The next run in the same thread reads it before its first token, so a weak
   model does not spend its whole budget re-reading a project it already mapped
   — which is exactly how a "continue" turn used to end with nothing written.

   Deterministic, local, one small JSON file per thread.
   --------------------------------------------------------------------------- */

export interface RunLedger {
  threadId: string
  updatedAt: number
  task: string
  plan: Plan | null
  openSteps: string[]
  files: string[]
  writes: number
  checks: number
  failures: number
  /** steps the last run spent — the next one knows how much room the task took */
  steps?: number
  /** what actually left the machine on this thread, by key. A run that resumes
      a benchmark must not re-submit what is already submitted, and must not
      claim a total it has not reached. */
  deliveries?: Delivery[]
  outcome: 'completed' | 'stopped-short' | 'partial' | 'blocked' | 'budget_exhausted' | 'cancelled' | 'failed'
  note: string
}

const DIR = join(DATA_DIR, 'ledgers')

function fileFor(threadId: string): string {
  const safe = threadId.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 80) || 'thread'
  return join(DIR, `${safe}.json`)
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function readLedger(threadId: string): RunLedger | null {
  if (!threadId) return null
  try {
    const raw = JSON.parse(readFileSync(fileFor(threadId), 'utf8')) as RunLedger
    if (!raw || raw.threadId !== threadId || typeof raw.updatedAt !== 'number') return null
    return {
      ...raw,
      openSteps: Array.isArray(raw.openSteps) ? raw.openSteps.filter((s) => typeof s === 'string') : [],
      files: Array.isArray(raw.files) ? raw.files.filter((s) => typeof s === 'string') : [],
      deliveries: Array.isArray(raw.deliveries)
        ? raw.deliveries.filter((d) => d && typeof d.key === 'string')
        : [],
    }
  } catch {
    return null
  }
}

export function writeLedger(input: {
  threadId: string
  task: string
  plan: Plan | null
  files: string[]
  writes: number
  checks: number
  failures: number
  steps?: number
  deliveries?: Delivery[]
  outcome: RunLedger['outcome']
  note: string
}): RunLedger | null {
  const openSteps = (input.plan?.steps ?? [])
    .filter((s) => s.status === 'pending' || s.status === 'in_progress')
    .map((s) => flat(s.description).slice(0, 120))
    .slice(0, 12)
  /* receipts accumulate across the thread: a delivery made in an earlier run
     is still a delivery, and losing it is how the same answer gets submitted
     twice — or claimed twice without being submitted at all */
  const previous = readLedger(input.threadId)?.deliveries ?? []
  const ledger: RunLedger = {
    threadId: input.threadId,
    updatedAt: Date.now(),
    task: flat(input.task).slice(0, 240),
    plan: input.plan,
    openSteps,
    files: input.files.map((f) => flat(f).slice(0, 120)).slice(0, 30),
    writes: input.writes,
    checks: input.checks,
    failures: input.failures,
    ...(typeof input.steps === 'number' ? { steps: input.steps } : {}),
    deliveries: mergeDeliveries(previous, input.deliveries).slice(-200),
    outcome: input.outcome,
    note: flat(input.note).slice(-300),
  }
  try {
    mkdirSync(DIR, { recursive: true })
    const file = fileFor(input.threadId)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(ledger), 'utf8')
    renameSync(tmp, file)
  } catch {
    /* a read-only data dir must not fail a finished run */
    return null
  }
  return ledger
}

function outcomeLine(ledger: RunLedger): string {
  switch (ledger.outcome) {
    case 'failed':
      return 'failed — the run ended without an answer'
    case 'partial':
      return `partial — ${ledger.openSteps.length} plan step(s) remain`
    case 'blocked':
      return 'blocked — a prerequisite or permission is missing'
    case 'budget_exhausted':
      return 'the run budget was exhausted'
    case 'cancelled':
      return 'cancelled by the user'
    case 'stopped-short':
      return `stopped short with ${ledger.openSteps.length} plan step(s) still open and no file written`
    default:
      return 'completed'
  }
}

/** the block the next run reads before it reads anything else */
export function ledgerBlock(ledger: RunLedger | null): string {
  if (!ledger) return ''
  const lines = ['', '', "--- last run on this thread (state, not a guess) ---"]
  if (ledger.task) lines.push(`Last task: ${ledger.task}`)
  lines.push(`Outcome: ${outcomeLine(ledger)}`)
  if (typeof ledger.steps === 'number' && ledger.steps > 0) {
    lines.push(`Steps the last run spent: ${ledger.steps}.`)
  }
  const doneSteps = (ledger.plan?.steps ?? [])
    .filter((s) => s.status === 'done')
    .map((s) => flat(s.description).slice(0, 100))
    .slice(0, 12)
  if (doneSteps.length > 0) {
    lines.push(`Steps already done (do not redo them): ${doneSteps.map((s, i) => `${i + 1}) ${s}`).join(' ')}`)
  }
  if (ledger.openSteps.length > 0) {
    const steps = ledger.openSteps.map((s, i) => `${i + 1}) ${s}`).join(' ')
    lines.push(`Open plan steps (${ledger.openSteps.length}): ${steps}`)
  } else if (ledger.plan) {
    lines.push('Plan: every step is marked done.')
  }
  if (ledger.files.length > 0) lines.push(`Files already changed last run: ${ledger.files.join(', ')}`)
  const delivered = ledger.deliveries ?? []
  if (delivered.length > 0) {
    const keys = delivered.slice(-40).map((d) => d.key)
    lines.push(
      `Already delivered on this thread (${delivered.length}) — do not redo these: ${keys.join(', ')}`,
    )
  }
  if (ledger.checks > 0 || ledger.failures > 0) {
    lines.push(`Checks last run: ${ledger.checks} passed, ${ledger.failures} failed.`)
  }
  if (ledger.note) lines.push(`Where the last run stopped: ${ledger.note}`)
  lines.push(
    'Start from the first open step. Do not redo a step marked done, and do not re-fetch or re-download what the files above already cover — verify the workspace first. Read only the files you are about to change — do not re-read the project to re-orient.',
  )
  return lines.join('\n')
}

/** "اكمل" and "continue" mean the open plan is this run's job too */
export function isContinuation(text: string): boolean {
  return /\b(?:continue|resume|carry on|keep going|pick up)\b|اكمل|كمل|استمر|تابع/i.test(text)
}
