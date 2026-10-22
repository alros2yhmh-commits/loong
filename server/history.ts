/* ---------------------------------------------------------------------------
   Conversation history search.

   Memory (`memory.ts`) is what Loong DECIDED to keep. This is everything it
   ever said — the sessions of every project. The two answer different
   questions: "what did we decide about the API?" is memory; "what did we try
   on the 14th, and what did it print?" is history.

   Scoped the way a person scopes it: the current project first, then the rest,
   each labelled with its project name so a fact from another folder is never
   mistaken for a fact about this one.
   --------------------------------------------------------------------------- */

import { listSessions, getMessages } from './db.ts'
import { getWorkspace } from './config.ts'

export interface HistoryHit {
  sessionId: string
  title: string
  /** the folder this conversation belongs to, by name */
  project: string | null
  /** true when the hit is from the workspace we are working in right now */
  currentProject: boolean
  at: number
  snippet: string
}

function projectName(workspace: string | null): string | null {
  if (!workspace) return null
  const parts = workspace.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : workspace
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 1)

/** the messages of a session, as one searchable string per session */
function sessionHaystack(sessionId: string): string {
  const rows = getMessages(sessionId, 500)
  return rows.map((r) => r.content).join('\n')
}

export function searchHistory(query: string, limit = 6): HistoryHit[] {
  const ws = getWorkspace()
  const words = tokens(query)
  const scored: { hit: HistoryHit; score: number }[] = []

  for (const session of listSessions(200)) {
    const currentProject = session.workspace != null && samePath(session.workspace, ws)
    const title = session.title ?? ''
    const body = sessionHaystack(session.id)
    const hay = `${title}\n${body}`.toLowerCase()

    let score = 0
    if (words.length === 0) {
      /* no query: the newest conversations of THIS project are the answer */
      score = currentProject ? 1 : 0
    } else {
      for (const w of words) {
        if (title.toLowerCase().includes(w)) score += 3
        if (hay.includes(w)) score += 1
      }
      if (currentProject) score += 1
    }
    if (score <= 0) continue

    /* the snippet is the first line that actually matched, not the start of
       the thread — a 500-message session's opening "hi" is not the answer */
    const lines = body.split('\n')
    let snippet = ''
    if (words.length > 0) {
      for (const line of lines) {
        const low = line.toLowerCase()
        if (words.some((w) => low.includes(w))) {
          snippet = line.trim().slice(0, 240)
          break
        }
      }
    }
    if (!snippet) snippet = (title || lines[0] || '').slice(0, 240)

    scored.push({
      score,
      hit: {
        sessionId: session.id,
        title,
        project: projectName(session.workspace),
        currentProject,
        at: session.updatedAt,
        snippet,
      },
    })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.hit.at - a.hit.at)
    .slice(0, limit)
    .map((s) => s.hit)
}
