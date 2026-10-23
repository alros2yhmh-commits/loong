/* ---------------------------------------------------------------------------
   Timers.

   "Do that in three minutes" is a request a person makes and an agent usually
   cannot honour: it answers, the turn ends, and the clock keeps running in a
   process that no longer exists. So the timer lives on disk, not in the turn.

   A timer is: a moment, a prompt, and the thread it should wake. When the
   moment arrives the agent creates the thread and hands the prompt to the app,
   which sends it exactly the way the reader would have. If the app is closed
   the timer waits — it is not lost, and it fires the moment the app is back.

   Why the app sends it and not the agent: the key lives in the key store the
   app owns, and a run needs it. A timer that could run without the app would
   need the key in the agent process, which is the one thing Loong refuses.
   --------------------------------------------------------------------------- */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.ts'
import { appendMessage, createSession, getSession } from './db.ts'

export interface Timer {
  id: string
  /** when it should fire, ms since epoch */
  at: number
  prompt: string
  title: string
  createdAt: number
  /** the thread it woke — set when it fires */
  sessionId: string | null
  firedAt: number | null
  /** the app has taken the prompt; nothing left to do */
  consumed: boolean
}

interface Store {
  timers: Timer[]
}

function file(): string {
  return join(DATA_DIR, 'timers.json')
}

function read(): Store {
  if (!existsSync(file())) return { timers: [] }
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Store
    return { timers: Array.isArray(parsed.timers) ? parsed.timers : [] }
  } catch {
    try {
      renameSync(file(), `${file()}.corrupt`)
    } catch {
      /* nothing to clean up */
    }
    return { timers: [] }
  }
}

function write(store: Store): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 1), 'utf8')
    renameSync(tmp, file())
  } catch {
    /* a full disk must not fail the run that scheduled it */
  }
}

/** "3m" / "90s" / "2h" / "1h30m" — what a person says, parsed */
export function parseDelay(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const parts = text.match(/(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours)/g)
  if (!parts || parts.length === 0) return null
  let ms = 0
  for (const part of parts) {
    const m = /(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours)/.exec(part)
    if (!m) continue
    const n = Number(m[1])
    const unit = m[2]
    if (unit === 'ms') ms += n
    else if (unit.startsWith('s')) ms += n * 1000
    else if (unit.startsWith('m')) ms += n * 60_000
    else ms += n * 3_600_000
  }
  return ms > 0 ? ms : null
}

export function addTimer(input: {
  afterMs: number
  prompt: string
  title?: string
}): Timer | { error: string } {
  if (!input.prompt.trim()) return { error: 'a timer without a prompt has nothing to do' }
  if (!Number.isFinite(input.afterMs) || input.afterMs <= 0) return { error: 'the delay is not a delay' }
  const timer: Timer = {
    id: randomUUID(),
    at: Date.now() + input.afterMs,
    prompt: input.prompt.trim(),
    title: (input.title ?? input.prompt).trim().slice(0, 60),
    createdAt: Date.now(),
    sessionId: null,
    firedAt: null,
    consumed: false,
  }
  const store = read()
  store.timers.push(timer)
  write(store)
  return timer
}

export function listTimers(): Timer[] {
  return read().timers.sort((a, b) => a.at - b.at)
}

export function cancelTimer(id: string): boolean {
  const store = read()
  const next = store.timers.filter((t) => t.id !== id)
  if (next.length === store.timers.length) return false
  write({ timers: next })
  return true
}

/**
 * Fire everything that is due. Called by a tick in the agent process.
 * Returns the timers that just fired, with the thread they woke.
 */
export function fireDue(now = Date.now()): Timer[] {
  const store = read()
  const fired: Timer[] = []
  for (const timer of store.timers) {
    if (timer.firedAt !== null || timer.at > now) continue
    /* the thread is created here, so the reader finds it waiting */
    const session = createSession({
      title: `⏱ ${timer.title}`,
      workspace: undefined,
    })
    appendMessage({
      sessionId: session.id,
      role: 'user',
      content: timer.prompt,
    })
    timer.sessionId = session.id
    timer.firedAt = now
    fired.push({ ...timer })
  }
  if (fired.length > 0) write(store)
  return fired
}

/** the app has sent the prompt — the timer is done */
export function ackTimer(id: string): void {
  const store = read()
  const timer = store.timers.find((t) => t.id === id)
  if (!timer) return
  timer.consumed = true
  write({ timers: store.timers.filter((t) => !t.consumed || t.firedAt === null) })
}

/** timers the app still has to send: fired, not consumed, thread exists */
export function pendingTimers(): Timer[] {
  return read().timers.filter(
    (t) => t.firedAt !== null && !t.consumed && t.sessionId && getSession(t.sessionId),
  )
}
