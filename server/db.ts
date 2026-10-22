import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   Sessions, on a JSON file.

   This used to be node:sqlite. That was elegant in dev and fatal in the app:
   the agent runs as a sidecar under Electron's own Node, and Electron 33 ships
   Node 20, which has no `node:sqlite`. The agent crashed on its first import
   and the packaged app showed "agent offline" forever.

   A session list is small — titles and chat turns — so a JSON file is the
   honest fit. It has no native build step, no runtime-version constraint, and
   no compiler on Windows. Writes are atomic (temp file + rename) and a corrupt
   file is moved aside rather than silently replaced.
   --------------------------------------------------------------------------- */

export interface SessionRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: string | null
  model: string | null
  /** the workspace this thread belongs to — a session is part of a PROJECT,
      and memory and recall are scoped by it. Null on threads from before
      the field existed; they are treated as belonging to no project. */
  workspace: string | null
}

export interface MessageRow {
  id: number
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
}

interface Store {
  version: 1
  sessions: SessionRow[]
  messages: MessageRow[]
  nextMessageId: number
}

const STORE_PATH = join(DATA_DIR, 'sessions.json')
const EMPTY: Store = { version: 1, sessions: [], messages: [], nextMessageId: 1 }

function isStore(value: unknown): value is Store {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.version === 1 &&
    Array.isArray(v.sessions) &&
    Array.isArray(v.messages) &&
    typeof v.nextMessageId === 'number'
  )
}

function load(): Store {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const raw = readFileSync(STORE_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isStore(parsed)) throw new Error('unexpected shape')
    return parsed
  } catch (err) {
    /* ENOENT is the normal first run. Anything else means the file exists but
       cannot be trusted — keep it, under a name that says so, and start clean
       rather than deleting someone's history. */
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      try {
        renameSync(STORE_PATH, `${STORE_PATH}.corrupt-${Date.now()}`)
      } catch {
        /* if even that fails, the in-memory store still works for this session */
      }
    }
    return { ...EMPTY }
  }
}

let store: Store = load()

/** temp file + rename, so a crash mid-write cannot truncate the real file */
function flush(): void {
  const body = JSON.stringify(store)
  const tmp = `${STORE_PATH}.tmp`
  try {
    writeFileSync(tmp, body, 'utf8')
    try {
      renameSync(tmp, STORE_PATH)
    } catch {
      /* Windows can refuse to replace an existing file; a direct write is the
         fallback, and the data is small enough that the window is negligible */
      writeFileSync(STORE_PATH, body, 'utf8')
      try {
        unlinkSync(tmp)
      } catch {
        /* nothing to clean up */
      }
    }
  } catch {
    /* a read-only data dir must not take the whole agent down */
  }
}

export function listSessions(limit = 200): SessionRow[] {
  return [...store.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export function getSession(id: string): SessionRow | null {
  return store.sessions.find((s) => s.id === id) ?? null
}

export function createSession(input: {
  title?: string
  provider?: string
  model?: string
  workspace?: string | null
}): SessionRow {
  const now = Date.now()
  const row: SessionRow = {
    id: randomUUID(),
    title: input.title?.trim() || 'New thread',
    createdAt: now,
    updatedAt: now,
    provider: input.provider ?? null,
    model: input.model ?? null,
    workspace: input.workspace ?? null,
  }
  store.sessions.push(row)
  flush()
  return row
}

export function renameSession(id: string, title: string): void {
  const row = store.sessions.find((s) => s.id === id)
  if (!row) return
  row.title = title.slice(0, 120)
  row.updatedAt = Date.now()
  flush()
}

export function touchSession(id: string): void {
  const row = store.sessions.find((s) => s.id === id)
  if (!row) return
  row.updatedAt = Date.now()
  flush()
}

export function deleteSession(id: string): void {
  store.sessions = store.sessions.filter((s) => s.id !== id)
  store.messages = store.messages.filter((m) => m.sessionId !== id)
  flush()
}

export function appendMessage(input: {
  sessionId: string
  role: MessageRow['role']
  content: string
}): void {
  if (!getSession(input.sessionId)) return
  store.messages.push({
    id: store.nextMessageId++,
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    createdAt: Date.now(),
  })
  touchSession(input.sessionId)
}

export function getMessages(sessionId: string, limit = 500): MessageRow[] {
  return store.messages
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.id - b.id)
    .slice(0, limit)
}

/** first user message becomes the thread title, the way every chat app does it */
export function autoTitle(sessionId: string, firstUserText: string): void {
  const row = getSession(sessionId)
  if (!row || row.title !== 'New thread') return
  const clean = firstUserText.replace(/\s+/g, ' ').trim()
  renameSession(sessionId, clean.slice(0, 60) || 'New thread')
}

export function closeDb(): void {
  flush()
}

/** only for tests: forget everything on disk and in memory */
export function resetStoreForTests(): void {
  store = { ...EMPTY, sessions: [], messages: [], nextMessageId: 1 }
  flush()
}
