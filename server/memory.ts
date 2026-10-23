import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, getWorkspace } from './config.ts'

/* ---------------------------------------------------------------------------
   Durable memory.

   A session ends; the fact does not. This is the small, honest store behind
   `remember` / `recall`: one JSON file, plain text entries, no embeddings and
   no vector database — because a desktop agent with a few hundred facts does
   not need one, and a store you cannot read with your own eyes is a store you
   cannot debug.

   Two scopes:
     - project  — true for one workspace only (a convention, a gotcha, a path)
     - global   — true everywhere (a preference, a name, a style rule)

   The file lives in DATA_DIR, never in the workspace: the agent may write
   memory through the tool, but it cannot reach the file to rewrite history.
   --------------------------------------------------------------------------- */

export type MemoryScope = 'project' | 'global'

export interface MemoryEntry {
  id: string
  text: string
  /** null = global; otherwise the workspace this entry belongs to */
  workspace: string | null
  at: number
}

/** a single entry is a sentence, not a document */
const MAX_ENTRY_CHARS = 600
/** the store is not a log; past this, the oldest entries fall off */
const MAX_ENTRIES = 500

function normalizeWorkspace(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function memoryFile(): string {
  return join(DATA_DIR, 'memory.json')
}

function readAll(): MemoryEntry[] {
  const file = memoryFile()
  if (!existsSync(file)) return []
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as { entries?: unknown }
    if (!Array.isArray(parsed.entries)) return []
    return parsed.entries.filter((e): e is MemoryEntry => {
      const o = e as Record<string, unknown>
      return typeof o?.id === 'string' && typeof o?.text === 'string' && typeof o?.at === 'number'
    })
  } catch {
    /* a corrupt memory file must not take the app down — move it aside and
       start clean, the same rule the session store follows */
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* if it cannot be moved, it is unreadable anyway */
    }
    return []
  }
}

function writeAll(entries: MemoryEntry[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const file = memoryFile()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8')
  renameSync(tmp, file)
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** save a fact. Identical text in the same scope is refreshed, not duplicated. */
export function remember(text: string, scope: MemoryScope = 'project'): MemoryEntry {
  const clean = clip(text, MAX_ENTRY_CHARS)
  if (!clean) throw new Error('Nothing to remember — the text was empty.')
  const workspace = scope === 'global' ? null : normalizeWorkspace(getWorkspace())
  const entries = readAll()
  const existing = entries.find(
    (e) => e.workspace === workspace && e.text.toLowerCase() === clean.toLowerCase(),
  )
  if (existing) {
    existing.at = Date.now()
    writeAll(entries)
    return existing
  }
  const entry: MemoryEntry = { id: randomUUID(), text: clean, workspace, at: Date.now() }
  entries.push(entry)
  /* drop the oldest beyond the cap, but never a global entry while a project
     one survives — global facts are the ones the user repeated on purpose */
  while (entries.length > MAX_ENTRIES) {
    const idx = entries.findIndex((e) => e.workspace !== null)
    entries.splice(idx === -1 ? 0 : idx, 1)
  }
  writeAll(entries)
  return entry
}

/** the entries that apply right now: this workspace's, plus every global one */
export function memoryForPrompt(limit = 16): MemoryEntry[] {
  const ws = normalizeWorkspace(getWorkspace())
  return readAll()
    .filter((e) => e.workspace === null || e.workspace === ws)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 1)
}

/**
 * Search by keyword overlap. No embeddings: a fact you cannot find by the
 * words in it is a fact you did not phrase well enough to keep.
 */
export function recall(query: string, limit = 8): MemoryEntry[] {
  const ws = normalizeWorkspace(getWorkspace())
  const applicable = readAll().filter((e) => e.workspace === null || e.workspace === ws)
  const words = tokens(query)
  if (words.length === 0) {
    return applicable.sort((a, b) => b.at - a.at).slice(0, limit)
  }
  const scored = applicable
    .map((e) => {
      const hay = e.text.toLowerCase()
      let score = 0
      for (const w of words) if (hay.includes(w)) score += 1
      return { e, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.e.at - a.e.at)
    .slice(0, limit)
  return scored.map((r) => r.e)
}

export function forget(id: string): boolean {
  const entries = readAll()
  const next = entries.filter((e) => e.id !== id)
  if (next.length === entries.length) return false
  writeAll(next)
  return true
}

export function listMemory(): MemoryEntry[] {
  return readAll().sort((a, b) => b.at - a.at)
}

/**
 * The block injected into the system prompt.
 *
 * Deliberately small and plainly worded: these are notes, not orders. A memory
 * that contradicts the workspace is wrong, and the agent is told so.
 */
export function memoryBlock(limit = 16): string {
  const entries = memoryForPrompt(limit)
  if (entries.length === 0) return ''
  const lines = entries.map((e) => `- ${clip(e.text, 240)}`)
  /* 2k, not 3k: memory is context, not instructions, and it grows without a
     ceiling if nobody sets one — every fact costs the prompt on every request */
  const body = clip(lines.join('\n'), 2_000)
  return `

DURABLE MEMORY — facts you saved in earlier sessions (newest first). They are true unless the
workspace contradicts them; if it does, trust the workspace and update the memory.
${body}`
}
