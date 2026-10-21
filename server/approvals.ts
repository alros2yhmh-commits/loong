import { randomUUID } from 'node:crypto'

/* ---------------------------------------------------------------------------
   The approval broker.

   A tool that needs permission does not fail and does not guess — it parks. The
   promise below stays unresolved, the SSE stream stays open, and the interface
   renders the gate. Nothing proceeds until a human answers or the request times
   out.

   Keeping this in memory is deliberate. An approval is only meaningful while
   the run that asked for it is still alive; persisting it would let a stale
   "yes" authorise a write in a later session.
   --------------------------------------------------------------------------- */

export interface ApprovalRequest {
  id: string
  tool: string
  title: string
  detail: string
  input: unknown
  createdAt: number
}

interface Pending {
  runId: string
  request: ApprovalRequest
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

/** how long a parked tool waits before it gives up and reports a timeout */
const TIMEOUT_MS = 5 * 60 * 1000

const pending = new Map<string, Pending>()

export type ApprovalListener = (request: ApprovalRequest) => void

const listeners = new Map<string, ApprovalListener[]>()

/** the agent subscribes so it can push the request down the open SSE stream */
export function onApprovalRequested(runId: string, fn: ApprovalListener): () => void {
  const list = listeners.get(runId) ?? []
  list.push(fn)
  listeners.set(runId, list)
  return () => {
    const next = (listeners.get(runId) ?? []).filter((f) => f !== fn)
    if (next.length) listeners.set(runId, next)
    else listeners.delete(runId)
  }
}

export function requestApproval(
  runId: string,
  input: { tool: string; title: string; detail: string; payload: unknown },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = randomUUID()
    const request: ApprovalRequest = {
      id,
      tool: input.tool,
      title: input.title,
      detail: input.detail,
      input: input.payload,
      createdAt: Date.now(),
    }

    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(false)
    }, TIMEOUT_MS)

    pending.set(id, { runId, request, resolve, timer })
    for (const fn of listeners.get(runId) ?? []) fn(request)
  })
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(approved)
  return true
}

export function pendingApprovals(): ApprovalRequest[] {
  return [...pending.values()].map((p) => p.request)
}

/** when a run dies, everything it parked dies with it — denied, not orphaned */
export function cancelRunApprovals(runId: string): number {
  listeners.delete(runId)
  let n = 0
  for (const [id, entry] of pending) {
    if (entry.runId !== runId) continue
    clearTimeout(entry.timer)
    entry.resolve(false)
    pending.delete(id)
    n++
  }
  return n
}

export function denyAllPending(): number {
  let n = 0
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.resolve(false)
    pending.delete(id)
    n++
  }
  return n
}

/* ---------------------------------------------------------------------------
   The question channel.

   An approval is a yes or a no. A question is not: "which of these three
   tables should this write to?" has an answer that is neither approve nor
   deny, and a run that cannot ask has to guess.

   This reuses the broker's shape exactly — park the promise, keep the stream
   open, wake on the answer — because that mechanism is already proven to be
   safe: a stale answer cannot authorise anything, and when the run dies the
   question dies with it. `null` means "nobody answered in time", which the
   caller must treat as a refusal, never as silence.
   --------------------------------------------------------------------------- */

export interface PendingQuestion {
  id: string
  runId: string
  question: string
  detail?: string
  /** suggested answers, offered as chips in the interface */
  options: string[]
  createdAt: number
}

interface ParkedQuestion {
  runId: string
  question: PendingQuestion
  resolve: (answer: string | null) => void
  timer: NodeJS.Timeout
}

/** a question is not allowed to sit unanswered forever */
const QUESTION_TIMEOUT_MS = 3 * 60 * 1000

const questions = new Map<string, ParkedQuestion>()

const questionListeners = new Map<string, ((q: PendingQuestion) => void)[]>()

export function onQuestionAsked(runId: string, fn: (q: PendingQuestion) => void): () => void {
  const list = questionListeners.get(runId) ?? []
  list.push(fn)
  questionListeners.set(runId, list)
  return () => {
    const next = (questionListeners.get(runId) ?? []).filter((f) => f !== fn)
    if (next.length) questionListeners.set(runId, next)
    else questionListeners.delete(runId)
  }
}

export function requestQuestion(
  runId: string,
  input: { question: string; detail?: string; options?: string[] },
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const id = randomUUID()
    const question: PendingQuestion = {
      id,
      runId,
      question: input.question,
      detail: input.detail,
      options: (input.options ?? []).slice(0, 5),
      createdAt: Date.now(),
    }

    const timer = setTimeout(() => {
      questions.delete(id)
      resolve(null)
    }, QUESTION_TIMEOUT_MS)

    questions.set(id, { runId, question, resolve, timer })
    for (const fn of questionListeners.get(runId) ?? []) fn(question)
  })
}

export function resolveQuestion(id: string, answer: string | null): boolean {
  const entry = questions.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  questions.delete(id)
  const text = typeof answer === 'string' ? answer.trim() : ''
  entry.resolve(text.length > 0 ? text : null)
  return true
}

export function pendingQuestions(): PendingQuestion[] {
  return [...questions.values()].map((q) => q.question)
}

export function cancelRunQuestions(runId: string): number {
  questionListeners.delete(runId)
  let n = 0
  for (const [id, entry] of questions) {
    if (entry.runId !== runId) continue
    clearTimeout(entry.timer)
    entry.resolve(null)
    questions.delete(id)
    n++
  }
  return n
}
