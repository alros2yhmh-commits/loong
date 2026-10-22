/* ---------------------------------------------------------------------------
   Thread snapshots.

   The database keeps the CONVERSATION (who said what) because that is what
   memory and history search read. It cannot keep the RUN: the tool calls, the
   approvals, the plan, the notices. A thread reopened used to lose all of it —
   every tool Loong ran vanished, which read as "the work disappeared".

   So the thread's blocks are snapshotted as they stand: one JSON file per
   session, written atomically, capped, and re-read on open. The client owns
   the fold (events → blocks) and therefore owns the snapshot — the server
   only stores what it is handed, which keeps one source of truth.
   --------------------------------------------------------------------------- */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/** a snapshot past this is dropped, not truncated: a thread that large is a
 *  thread nobody reopens for its tools */
const MAX_SNAPSHOT_CHARS = 4_000_000

function threadsDir(): string {
  return join(DATA_DIR, 'threads')
}

function snapshotFile(sessionId: string): string {
  /* the id is a uuid from the server itself; a path traversal would have to
     come from inside, and every id that reaches here is validated by the
     caller's session store */
  return join(threadsDir(), `${sessionId.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
}

/** store the blocks of a thread, exactly as the reader last saw them */
export function saveBlocks(sessionId: string, blocks: unknown[]): void {
  const dir = threadsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = snapshotFile(sessionId)
  const payload = JSON.stringify({ sessionId, blocks, at: Date.now() })
  if (payload.length > MAX_SNAPSHOT_CHARS) return
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, file)
  } catch {
    /* a full disk must not fail the run that just finished */
  }
}

export function loadBlocks(sessionId: string): unknown[] | null {
  const file = snapshotFile(sessionId)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { blocks?: unknown }
    return Array.isArray(parsed.blocks) ? parsed.blocks : null
  } catch {
    /* a corrupt snapshot falls back to the conversation in the database —
       losing the tools is bad, losing the thread is worse */
    try {
      renameSync(file, `${file}.corrupt`)
    } catch {
      /* nothing to clean up */
    }
    return null
  }
}

/** a deleted thread takes its run with it */
export function deleteBlocks(sessionId: string): void {
  try {
    const file = snapshotFile(sessionId)
    if (existsSync(file)) rmSync(file)
  } catch {
    /* already gone */
  }
}
