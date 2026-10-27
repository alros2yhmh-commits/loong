import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, lstatSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DATA_DIR, resolveInside } from './config.ts'
import { currentRunId } from './run-context.ts'

/* ---------------------------------------------------------------------------
   The write journal — how a run is undone.

   Every change the agent makes records what the file looked like BEFORE the
   change, appended to a journal as it happens. A run that goes wrong — a bad
   refactor, a rewrite of the wrong module — is then one call away from being
   undone: walk that run's entries backwards and put every file back.

   `before: null` means the file did not exist: the run created it, so undoing
   means deleting it. `mkdir` records the same way, and a move is a delete plus
   a create, which is why reverse order matters: the last write to a file wins
   on the way in and loses on the way out, and undoing has to run last-write
   first to land on the true before.

   The journal lives in DATA_DIR, never in the workspace — the agent cannot
   reach it to rewrite its own history.
   --------------------------------------------------------------------------- */

interface JournalEntry {
  runId: string
  at: number
  op: 'write' | 'mkdir' | 'delete' | 'move'
  path: string
  /** what the path held before the op; null when it did not exist */
  before: string | null
  /** when true, beforeB64 holds the previous bytes as base64 (binary-safe) */
  binary?: boolean
  beforeB64?: string | null
  /** the state the tool left behind; undo must not overwrite later user edits */
  afterFingerprint?: string
  afterCanonical?: string
  beforeDirectory?: boolean
}

function canonicalLocation(path: string): string {
  let ancestor = path
  const suffix: string[] = []
  for (;;) {
    try { return join(realpathSync(ancestor), ...suffix.reverse()) } catch {
      const parent = dirname(ancestor)
      if (parent === ancestor) return path
      suffix.push(basename(ancestor))
      ancestor = parent
    }
  }
}

function fingerprint(path: string): string {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return 'unsupported'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return `file:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
    return 'unsupported'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

function dir(): string {
  const d = join(DATA_DIR, 'journal')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function journalFile(): string {
  return join(dir(), 'writes.jsonl')
}

/** record one change. Called after the change succeeded, so a failed op never lies. */
export function recordWrite(
  op: JournalEntry['op'],
  path: string,
  /** the previous content, or null when the file is new. A Buffer means the
   *  previous bytes were binary — they are stored base64 so a rewind restores
   *  them byte-for-byte instead of mangling them through a UTF-8 round-trip. */
  before: string | Buffer | null,
  options: { beforeDirectory?: boolean } = {},
): void {
  const runId = currentRunId()
  if (!runId) return
  const isBinary = typeof before !== 'string' && before !== null
  const entry: JournalEntry = {
    runId,
    at: Date.now(),
    op,
    path,
    before: typeof before === 'string' ? before : null,
    binary: isBinary,
    beforeB64: isBinary && before ? (before as Buffer).toString('base64') : null,
    afterFingerprint: fingerprint(path),
    afterCanonical: canonicalLocation(path),
    ...(options.beforeDirectory ? { beforeDirectory: true } : {}),
  }
  try {
    appendFileSync(journalFile(), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    /* a journal that cannot be written must not fail the user's task */
  }
}

function readEntries(): JournalEntry[] {
  try {
    if (!existsSync(journalFile())) return []
    return readFileSync(journalFile(), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as JournalEntry
        } catch {
          return null
        }
      })
      .filter((e): e is JournalEntry => e !== null)
  } catch {
    return []
  }
}

export interface Checkpoint {
  runId: string
  at: number
  files: number
  ops: number
}

/** one checkpoint per run that changed something, newest first */
export function listCheckpoints(): Checkpoint[] {
  const byRun = new Map<string, { at: number; files: Set<string>; ops: number }>()
  for (const e of readEntries()) {
    const row = byRun.get(e.runId) ?? { at: e.at, files: new Set<string>(), ops: 0 }
    row.files.add(e.path)
    row.ops += 1
    row.at = Math.max(row.at, e.at)
    byRun.set(e.runId, row)
  }
  return [...byRun.entries()]
    .map(([runId, row]) => ({ runId, at: row.at, files: row.files.size, ops: row.ops }))
    .sort((a, b) => b.at - a.at)
}

export interface RewindResult {
  runId: string
  restored: string[]
  removed: string[]
  conflicts: { path: string; reason: string }[]
  failed: string[]
}

/** undo one run: its entries, last write first, each file put back as it was */
export function rewindRun(runId: string): RewindResult | null {
  const entries = readEntries().filter((e) => e.runId === runId)
  if (entries.length === 0) return null
  const restored: string[] = []
  const removed: string[] = []
  const failed: string[] = []
  const conflicts: RewindResult['conflicts'] = []
  const blocked = new Set<string>()
  /* Compare with the LAST state from this run before changing anything. A
     rewind of an older run must not overwrite a later run or a user's edits.
     Old journals did not store the after-state, so preserve them for manual
     recovery rather than guessing that their current content is still ours. */
  const lastByPath = new Map(entries.map((entry) => [entry.path, entry]))
  for (const [path, entry] of lastByPath) {
    let reason: string | null = null
    try {
      const abs = resolveInside(path)
      if (!entry.afterFingerprint) reason = 'This older checkpoint has no after-state; restore it manually to preserve later changes.'
      else if (['unreadable', 'unsupported'].includes(entry.afterFingerprint)) reason = 'The checkpoint could not capture a restorable after-state.'
      else if (entry.afterCanonical && canonicalLocation(abs) !== entry.afterCanonical) reason = 'The path now points to a different location; your current content was preserved.'
      else if (fingerprint(abs) !== entry.afterFingerprint) reason = 'The path changed after this run; your current content was preserved.'
    } catch {
      reason = 'The path is no longer accessible inside the current workspace.'
    }
    if (reason) {
      blocked.add(path)
      conflicts.push({ path, reason })
    }
  }
  for (const e of [...entries].reverse()) {
    if (blocked.has(e.path)) continue
    try {
      /* re-validate the path against the workspace on the way back out. The
         journal records what changed, not where it may be restored; a path that
         no longer resolves inside the workspace is never written. */
      const abs = resolveInside(e.path)
      if ((e.afterCanonical && canonicalLocation(abs) !== e.afterCanonical) || fingerprint(abs) !== e.afterFingerprint) {
        blocked.add(e.path)
        conflicts.push({ path: e.path, reason: 'The path changed during rewind and was preserved.' })
        continue
      }
      /* "remove" only when the run CREATED the path: a mkdir, or a write whose
         before was null. A binary write also stores before=null (its bytes live
         in beforeB64), so it is flagged binary — that is an existing file to
         restore, never one to delete. */
      const created = !e.beforeDirectory && (e.op === 'mkdir' || (e.before === null && !e.binary))
      if (created) {
        if (existsSync(abs)) {
          /* Never recursively remove a directory on rewind: it might now hold
             an unrelated file the user created after the run. */
          if (statSync(abs).isDirectory()) rmdirSync(abs)
          else rmSync(abs, { force: true })
        }
        removed.push(abs)
      } else if (e.beforeDirectory) {
        mkdirSync(abs, { recursive: true })
        restored.push(abs)
      } else {
        const data: string | Buffer =
          e.binary && typeof e.beforeB64 === 'string' ? Buffer.from(e.beforeB64, 'base64') : (e.before as string)
        mkdirSync(dirname(abs), { recursive: true })
        if (typeof data === 'string') writeFileSync(abs, data, 'utf8')
        else writeFileSync(abs, data)
        restored.push(abs)
      }
    } catch (err) {
      blocked.add(e.path)
      if (['ENOTEMPTY', 'EEXIST'].includes((err as NodeJS.ErrnoException).code ?? '')) {
        conflicts.push({ path: e.path, reason: 'The directory contains later files and was preserved.' })
        continue
      }
      /* never swallow a failed restore — the rest of the rewind still runs, but
         the failure is logged and reported so the user knows the undo is partial */
      failed.push(e.path)
    }
  }
  return { runId, restored, removed, conflicts, failed }
}

/** the unique paths a run changed — the security gate scans exactly these */
export function filesForRun(runId: string): string[] {
  const set = new Set<string>()
  for (const e of readEntries()) if (e.runId === runId) set.add(e.path)
  return [...set]
}

/** undo the most recent run that changed something */
export function rewindLastRun(): RewindResult | null {
  const latest = listCheckpoints()[0]
  return latest ? rewindRun(latest.runId) : null
}
