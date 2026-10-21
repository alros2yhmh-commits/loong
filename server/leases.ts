import { resolveInside } from './config.ts'

/* ---------------------------------------------------------------------------
   File write leases.

   Several sessions can run at once — that is the point of the thread model. But
   they share one workspace, and two runs writing the same file is how a project
   gets corrupted: the second write silently overwrites the first.

   So a write is a lease. Before a run writes a path it takes an EXCLUSIVE lease
   on it; another run that wants the same path waits a short while and then gets
   a clear "another session is editing this" answer instead of clobbering it.
   Leases are acquired in sorted order (no deadlock), expire after a TTL (a
   crashed run cannot hold a file forever), and are released in a finally.

   This is in-process on purpose: one app process owns the workspace. External
   editors are outside this boundary and are caught by the optimistic check the
   write tools already do (read → write) plus the rewind journal.
   --------------------------------------------------------------------------- */

const TTL_MS = 120_000
const POLL_MS = 60

interface Lease {
  runId: string
  at: number
}

const leases = new Map<string, Lease>()

/** the key a lease is held under — the canonical absolute path when possible */
function key(path: string): string {
  try {
    return resolveInside(path)
  } catch {
    return path
  }
}

function reclaim(k: string): void {
  const held = leases.get(k)
  if (held && Date.now() - held.at > TTL_MS) leases.delete(k)
}

async function acquireOne(runId: string, k: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  for (;;) {
    reclaim(k)
    const held = leases.get(k)
    /* free, or already ours (a re-entrant call inside one run) */
    if (!held || held.runId === runId) {
      leases.set(k, { runId, at: Date.now() })
      return true
    }
    if (Date.now() - start >= timeoutMs) return false
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

export interface LeaseHandle {
  release: () => void
  paths: string[]
}

/**
 * Take exclusive write leases on every path, in sorted order. Returns null when
 * any path stays busy past the timeout — the caller must then tell the model to
 * wait or choose another file, never to write anyway.
 */
export async function acquireWriteLease(
  runId: string,
  rawPaths: string[],
  timeoutMs = 8_000,
): Promise<LeaseHandle | null> {
  const keys = [...new Set(rawPaths.filter(Boolean).map(key))].sort()
  if (keys.length === 0) return { release: () => {}, paths: [] }
  const got: string[] = []
  for (const k of keys) {
    const ok = await acquireOne(runId, k, timeoutMs)
    if (!ok) {
      /* release what we took so a partial acquisition cannot strand files */
      for (const g of got) {
        const held = leases.get(g)
        if (!held || held.runId === runId) leases.delete(g)
      }
      return null
    }
    got.push(k)
  }
  return {
    release: () => {
      for (const g of got) {
        const held = leases.get(g)
        if (!held || held.runId === runId) leases.delete(g)
      }
    },
    paths: got,
  }
}

/** what is held right now — for the agents workbench and diagnostics */
export function activeLeases(): { path: string; runId: string; ageMs: number }[] {
  const now = Date.now()
  const out: { path: string; runId: string; ageMs: number }[] = []
  for (const [path, held] of leases) {
    if (now - held.at <= TTL_MS) out.push({ path, runId: held.runId, ageMs: now - held.at })
  }
  return out
}
