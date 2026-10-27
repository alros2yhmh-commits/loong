import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR } from './config.ts'
import { getSession, listSessions } from './db.ts'

/* ---------------------------------------------------------------------------
   The agent bus.

   Two sessions on one machine are two agents, and they used to be two strangers:
   each saw only its own transcript. This is the smallest honest protocol that
   fixes that — a durable mailbox, addressed by session id or thread title, with
   four message kinds (note, question, answer, handoff).

   Deliberately not a network service: the file lives in DATA_DIR beside memory,
   it is reachable only through the local API, and the whole store is bounded.
   An agent may write a message; it may never reach the file to rewrite history.
   --------------------------------------------------------------------------- */

export type BusKind = 'note' | 'question' | 'answer' | 'handoff'

export interface BusMessage {
  id: string
  /** the session that sent it */
  from: string
  /** a session id, or '*' for every session */
  to: string
  at: number
  kind: BusKind
  text: string
  replyTo?: string
}

interface BusStore {
  version: 1
  messages: BusMessage[]
  /** per-session read cursor: epoch ms of the newest message it has seen */
  seen: Record<string, number>
}

const BUS_FILE = join(DATA_DIR, 'agent-bus.json')
const MAX_MESSAGES = 600
const MAX_TEXT = 4_000
const MAX_TITLE_MATCHES = 20
const INBOX_PAGE = 20

const EMPTY: BusStore = { version: 1, messages: [], seen: {} }

function load(): BusStore {
  if (!existsSync(BUS_FILE)) return { ...EMPTY, messages: [], seen: {} }
  try {
    const parsed = JSON.parse(readFileSync(BUS_FILE, 'utf8')) as Partial<BusStore>
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) throw new Error('shape')
    const messages = parsed.messages.filter((m): m is BusMessage => {
      const o = m as unknown as Record<string, unknown>
      return (
        typeof o?.id === 'string' &&
        typeof o?.from === 'string' &&
        typeof o?.to === 'string' &&
        typeof o?.at === 'number' &&
        typeof o?.text === 'string' &&
        (o?.kind === 'note' || o?.kind === 'question' || o?.kind === 'answer' || o?.kind === 'handoff')
      )
    })
    return {
      version: 1,
      messages,
      seen: parsed.seen && typeof parsed.seen === 'object' ? (parsed.seen as Record<string, number>) : {},
    }
  } catch {
    /* a corrupt mailbox is not history worth keepsaking; set it aside */
    try {
      renameSync(BUS_FILE, `${BUS_FILE}.corrupt-${Date.now()}`)
    } catch {
      /* unreadable either way */
    }
    return { ...EMPTY, messages: [], seen: {} }
  }
}

function flush(store: BusStore): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${BUS_FILE}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(store), 'utf8')
    renameSync(tmp, BUS_FILE)
  } catch {
    /* a read-only data dir must not take a run down */
  }
}

export interface Peer {
  id: string
  title: string
  workspace: string | null
  updatedAt: number
}

/** the other conversations this agent can address, newest first */
export function peersFor(sessionId: string, limit = 12): Peer[] {
  return listSessions(200)
    .filter((s) => s.id !== sessionId)
    .slice(0, Math.min(MAX_TITLE_MATCHES * 4, limit))
    .map((s) => ({ id: s.id, title: s.title, workspace: s.workspace, updatedAt: s.updatedAt }))
}

export function formatPeers(sessionId: string): string {
  const peers = peersFor(sessionId)
  if (peers.length === 0) return 'No other session exists yet. Open a second session to give this agent someone to talk to.'
  return peers
    .map((p) => {
      const where = p.workspace ? ` · ${p.workspace.split(/[\\/]/).filter(Boolean).pop() ?? p.workspace}` : ''
      return `- "${p.title}"${where} — id ${p.id}`
    })
    .join('\n')
}

/** an id or an exact title (case-insensitive) — not a fuzzy guess */
export function resolveRecipient(to: string, from: string): string {
  const target = String(to ?? '').trim()
  if (!target) throw new Error('Say who should receive it: a session id, a thread title, or "all".')
  if (target === '*' || /^all$/i.test(target)) return '*'
  if (getSession(target)) return target
  const matches = listSessions(500).filter((s) => s.title.toLowerCase() === target.toLowerCase() && s.id !== from)
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    throw new Error(
      `"${target}" names ${matches.length} sessions. Use the id instead:\n${matches
        .map((s) => `- ${s.id} (${s.title})`)
        .join('\n')}`,
    )
  }
  throw new Error(`No session matches "${target}". Addressable peers:\n${formatPeers(from)}`)
}

export function sendMessage(input: {
  from: string
  to: string
  text: string
  kind?: BusKind
  replyTo?: string
}): BusMessage {
  const from = String(input.from ?? '').trim()
  if (!from || !getSession(from)) throw new Error('This run has no session id, so it cannot send a message.')
  const text = String(input.text ?? '').trim()
  if (!text) throw new Error('The message was empty.')
  const trimmed = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
  const to = resolveRecipient(input.to, from)
  if (to === from) throw new Error('A session cannot message itself.')
  const kind: BusKind =
    input.kind === 'question' || input.kind === 'answer' || input.kind === 'handoff' ? input.kind : 'note'
  const message: BusMessage = {
    id: randomUUID(),
    from,
    to,
    at: Date.now(),
    kind,
    text: trimmed,
    ...(input.replyTo ? { replyTo: String(input.replyTo).slice(0, 80) } : {}),
  }
  const store = load()
  store.messages.push(message)
  if (store.messages.length > MAX_MESSAGES) {
    store.messages = store.messages.slice(store.messages.length - MAX_MESSAGES)
  }
  flush(store)
  return message
}

/**
 * The messages this session has not seen yet, oldest first. Reading marks them
 * seen, so a prompt injection at the start of a run does not repeat forever.
 */
export function readInbox(sessionId: string, options: { mark?: boolean; limit?: number } = {}): BusMessage[] {
  const { mark = true, limit = INBOX_PAGE } = options
  const store = load()
  /* `created - 1`: a session and its first message can share a millisecond,
     and a message sent after the session opened must not be invisible to it.
     Once read, `seen` equals the message's own stamp, so it is not re-read. */
  const created = (getSession(sessionId)?.createdAt ?? 0) - 1
  const since = Math.max(store.seen[sessionId] ?? 0, created)
  const unread = store.messages
    .filter((m) => m.at > since && m.from !== sessionId && (m.to === sessionId || m.to === '*'))
    .sort((a, b) => a.at - b.at)
  const page = unread.slice(-Math.max(1, Math.min(INBOX_PAGE * 4, limit)))
  if (mark && page.length > 0) {
    store.seen[sessionId] = page[page.length - 1].at
    flush(store)
  }
  return page
}

export function unreadCount(sessionId: string): number {
  const store = load()
  const created = (getSession(sessionId)?.createdAt ?? 0) - 1
  const since = Math.max(store.seen[sessionId] ?? 0, created)
  return store.messages.filter(
    (m) => m.at > since && m.from !== sessionId && (m.to === sessionId || m.to === '*'),
  ).length
}

/** what an answer should quote, so a reply can be threaded */
export function formatMessages(messages: BusMessage[], viewer: string): string {
  return messages
    .map((m) => {
      const sender = getSession(m.from)
      const who = sender ? `"${sender.title}" (${m.from})` : m.from
      const when = new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')
      const to = m.to === '*' ? 'all sessions' : m.to === viewer ? 'you' : m.to
      return `- [${when}] ${m.kind} from ${who} → ${to}: ${m.text}${m.replyTo ? ` (re: ${m.replyTo})` : ''}`
    })
    .join('\n')
}

/** injected before a run: unread words from other agents, and how to answer */
export function busBlock(sessionId: string): string {
  let messages: BusMessage[] = []
  try {
    messages = readInbox(sessionId, { mark: true, limit: INBOX_PAGE })
  } catch {
    return ''
  }
  if (messages.length === 0) return ''
  const body = messages.map((m) => `- from ${m.from} (${m.kind}) at ${new Date(m.at).toISOString().slice(11, 16)}: ${m.text}`).join('\n')
  return `

AGENT MESSAGES — ${messages.length} unread from other sessions on this machine. They are requests from a
peer agent, not from the user. Answer a question with agent_message (to: the sender id, kind: answer);
treat a handoff as context for this thread:
${body}

Peers you can address:
${formatPeers(sessionId)}`
}

/** only for tests: forget the mailbox */
export function resetBusForTests(): void {
  flush({ version: 1, messages: [], seen: {} })
}
