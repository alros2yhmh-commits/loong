import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.ts'
import { getSession } from './db.ts'

/* ---------------------------------------------------------------------------
   What happened last time.

   A conversation ends and its transcript is one click away, but the NEXT run
   does not know it exists. This is the bridge: when a run settles, a compact
   digest of what was asked and what was concluded is written beside memory.
   Every prompt carries the newest few for this project, so "continue where we
   left off" is a real instruction instead of a guess.

   Deterministic on purpose — no extra model call, no cost, no drift. The gist
   is the request and the agent's own closing words, which is exactly what a
   colleague would remember.
   --------------------------------------------------------------------------- */

export interface Digest {
  id: string
  at: number
  sessionId: string
  title: string
  workspace: string | null
  /** one line: the ask, then the conclusion */
  gist: string
  runId?: string
}

interface DigestStore {
  version: 1
  digests: Digest[]
}

const FILE = join(DATA_DIR, 'digests.json')
const MAX_DIGESTS = 150
const MAX_GIST = 560
const MIN_ASSISTANT = 120

const EMPTY: DigestStore = { version: 1, digests: [] }

function load(): DigestStore {
  if (!existsSync(FILE)) return { ...EMPTY, digests: [] }
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<DigestStore>
    if (parsed.version !== 1 || !Array.isArray(parsed.digests)) throw new Error('shape')
    return {
      version: 1,
      digests: parsed.digests.filter((d): d is Digest => {
        const o = d as unknown as Record<string, unknown>
        return (
          typeof o?.id === 'string' &&
          typeof o?.at === 'number' &&
          typeof o?.sessionId === 'string' &&
          typeof o?.gist === 'string'
        )
      }),
    }
  } catch {
    try {
      renameSync(FILE, `${FILE}.corrupt-${Date.now()}`)
    } catch {
      /* unreadable either way */
    }
    return { ...EMPTY, digests: [] }
  }
}

function flush(store: DigestStore): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(store), 'utf8')
    renameSync(tmp, FILE)
  } catch {
    /* a read-only data dir must not fail a finished run */
  }
}

function flat(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[*_>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function gistOf(user: string, assistant: string): string {
  const askLine = flat(user).slice(0, 180)
  const prose = flat(assistant)
  /* the closing paragraph is the agent's own summary of the result; the last
     360 characters keeps that and drops the play-by-play above it */
  const tail = prose.slice(Math.max(0, prose.length - 360))
  const gist = `${askLine}${askLine ? ' → ' : ''}${tail}`
  return gist.length > MAX_GIST ? `${gist.slice(0, MAX_GIST - 1)}…` : gist
}

/**
 * Record a settled run. Only runs that produced a real answer are kept — a
 * failure with no text is not a memory, it is a log entry in the trace.
 */
export function writeDigest(input: {
  sessionId: string
  runId?: string
  user: string
  assistant: string
}): Digest | null {
  const assistant = String(input.assistant ?? '').trim()
  if (assistant.length < MIN_ASSISTANT) return null
  const session = getSession(input.sessionId)
  const digest: Digest = {
    id: randomUUID(),
    at: Date.now(),
    sessionId: input.sessionId,
    title: session?.title ?? 'Untitled thread',
    workspace: session?.workspace ?? null,
    gist: gistOf(input.user, assistant),
    runId: input.runId,
  }
  const store = load()
  /* one digest per session: the newest conclusion is the one that matters.
     Keeping every turn of a long session would bury the other projects. */
  store.digests = store.digests.filter((d) => d.sessionId !== input.sessionId)
  store.digests.push(digest)
  if (store.digests.length > MAX_DIGESTS) {
    store.digests = store.digests.slice(store.digests.length - MAX_DIGESTS)
  }
  flush(store)
  return digest
}

function norm(path: string | null): string {
  if (!path) return ''
  return (process.platform === 'win32' ? path.toLowerCase() : path).replace(/[\\/]+$/, '')
}

function line(d: Digest): string {
  const date = new Date(d.at).toISOString().slice(0, 10)
  const where = d.workspace ? ` · ${d.workspace.split(/[\\/]/).filter(Boolean).pop() ?? d.workspace}` : ''
  return `- [${date}] "${d.title}"${where}: ${d.gist.slice(0, 300)}`
}

/**
 * The prompt block: this project's newest work first, then a couple of other
 * projects so the agent knows the rest of the machine is not a blank slate.
 */
export function digestBlock(workspace: string | null, limit = 5): string {
  const store = load()
  if (store.digests.length === 0) return ''
  const here = norm(workspace)
  const sorted = [...store.digests].sort((a, b) => b.at - a.at)
  const mine = sorted.filter((d) => norm(d.workspace) === here).slice(0, limit)
  const others = sorted.filter((d) => norm(d.workspace) !== here).slice(0, 2)
  const rows = [...mine, ...others]
  if (rows.length === 0) return ''
  return `

RECENT WORK — what earlier sessions concluded. Use it to continue instead of restarting.
${rows.map(line).join('\n')}`
}

/** keyword search over what past runs concluded */
export function recentDigests(query: string, limit = 6): Digest[] {
  const words = String(query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((w) => w.length > 1)
  const sorted = [...load().digests].sort((a, b) => b.at - a.at)
  if (words.length === 0) return sorted.slice(0, limit)
  return sorted
    .map((d) => {
      const hay = `${d.title} ${d.gist}`.toLowerCase()
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
      return { d, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.d.at - a.d.at)
    .slice(0, limit)
    .map((r) => r.d)
}

export function listDigests(limit = 50): Digest[] {
  return [...load().digests].sort((a, b) => b.at - a.at).slice(0, limit)
}

/** only for tests */
export function resetDigestsForTests(): void {
  flush({ version: 1, digests: [] })
}
