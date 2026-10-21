import { AsyncLocalStorage } from 'node:async_hooks'

/* ---------------------------------------------------------------------------
   Which run is this.

   The tools are static — they exist once per process, not once per run — but
   the journal needs to know which run a write belongs to.

   This used to be one module-level string. That was correct while the app ran
   one turn at a time and wrong the moment two threads could run together: the
   second run overwrote the first's id, and a write from one was journaled
   against the other, so a rewind restored the wrong files.

   AsyncLocalStorage carries the id on the async context instead, so a tool
   inherits the run that called it no matter how many are in flight. The plain
   setter stays as a fallback for a direct call outside a wrapped context (a
   test, a one-off script).
   --------------------------------------------------------------------------- */

const storage = new AsyncLocalStorage<string>()
let fallback: string | null = null

export function setCurrentRun(runId: string | null): void {
  fallback = runId
}

export function currentRunId(): string | null {
  return storage.getStore() ?? fallback
}

/** run a function with a run id attached to everything it awaits */
export function runWithRunId<T>(runId: string, fn: () => T): T {
  return storage.run(runId, fn)
}
