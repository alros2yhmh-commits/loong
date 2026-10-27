/* ---------------------------------------------------------------------------
   The cycle.

   A run is not one long "do something" — it is a loop with named phases, and
   each phase has a different job. The failure this fixes is a weak model that
   skips recon, edits from imagination, and calls the result done because it
   stopped typing.

   The machine is deterministic and lives on the tool boundary, not in the
   prompt: a tool call is what moves the run, not the model's opinion about
   which phase it is in. That makes it testable, and it makes the phase shown
   in the interface true.

       intake → recon → plan → act → verify → reflect
                          ↑       │       │
                          └───────┴───────┘  (a failed check goes back to act)

   Evidence is the other half: a write is a claim, a passing check is proof.
   `missingEvidence` is the stop gate's input — "no evidence, no done".
   --------------------------------------------------------------------------- */

export type Phase = 'intake' | 'recon' | 'plan' | 'act' | 'verify' | 'reflect'

export const PHASES: Phase[] = ['intake', 'recon', 'plan', 'act', 'verify', 'reflect']

export interface CycleEvent {
  tool: string
  ok: boolean
  input?: Record<string, unknown>
}

export interface CycleState {
  phase: Phase
  previous: Phase
  /** tool calls observed in this run */
  step: number
  reads: number
  writes: number
  verifications: number
  failures: number
  /** timestamps: the stop gate compares them */
  lastWriteAt: number
  lastVerifyOkAt: number
  startedAt: number
  history: { phase: Phase; at: number; reason: string }[]
}

const READ_TOOLS = new Set([
  'list_dir',
  'read_file',
  'read_many',
  'read_image',
  'read_document',
  'grep',
  'search_many',
  'project_overview',
  'graph_map',
  'graph_neighbors',
  'graph_impact',
  'git_status',
  'git_diff',
  'git_log',
  'library_docs',
  'library_search',
  'read_library',
  'recall',
  'past_sessions',
])

const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'edit_many',
  'mkdir',
  'delete_file',
  'move_file',
  'propose_changes',
  'run_code',
])

const VERIFY_TOOLS = new Set([
  'run_verification',
  'run_project',
  'compare_screens',
  'security_scan',
  'red_team',
])

/** a shell command that is really a check, not a lookup */
const CHECK_COMMAND = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b|\b(?:tsc|vitest|jest|pytest|mypy|ruff|cargo\s+(?:test|check)|go\s+(?:test|vet)|dotnet\s+(?:test|build)|mvn\s+test|gradle\w*\s+(?:test|check))/i

export function createCycle(now = Date.now()): CycleState {
  return {
    phase: 'intake',
    previous: 'intake',
    step: 0,
    reads: 0,
    writes: 0,
    verifications: 0,
    failures: 0,
    lastWriteAt: 0,
    lastVerifyOkAt: 0,
    startedAt: now,
    history: [{ phase: 'intake', at: now, reason: 'run started' }],
  }
}

function move(state: CycleState, to: Phase, reason: string, now = Date.now()): Phase | null {
  if (state.phase === to) return null
  state.previous = state.phase
  state.phase = to
  state.history.push({ phase: to, at: now, reason })
  if (state.history.length > 40) state.history.shift()
  return to
}

/**
 * Fold one tool result into the cycle. Returns the new phase when it changed.
 *
 * One observation may move the run twice (a write in `recon` skips the plan and
 * lands in `act`), so the function reports the phase it ended in, not each hop.
 */
export function observe(state: CycleState, ev: CycleEvent, now = Date.now()): Phase | null {
  state.step += 1
  const name = ev.tool
  const isRead = READ_TOOLS.has(name)
  const isWrite = WRITE_TOOLS.has(name)
  const isShellCheck =
    name === 'shell' && CHECK_COMMAND.test(String(ev.input?.command ?? ''))
  const isVerify = VERIFY_TOOLS.has(name) || isShellCheck

  if (isRead) state.reads += 1
  if (isWrite) {
    state.writes += 1
    state.lastWriteAt = now
  }
  if (isVerify) {
    state.verifications += 1
    if (ev.ok) state.lastVerifyOkAt = now
    else state.failures += 1
  }

  if (!ev.ok) {
    /* a failed edit or command in ACT stays in ACT: retrying in the same phase
       is the point. A failed check in VERIFY sends it back to ACT. */
    if (state.phase === 'verify' && isVerify) return move(state, 'act', 'the check failed — repair it', now)
    if (state.phase === 'intake') return move(state, 'recon', 'the first call failed — look before retrying', now)
    return null
  }

  switch (state.phase) {
    case 'intake':
      if (name === 'update_plan') return move(state, 'plan', 'a plan arrived first', now)
      if (isWrite) return move(state, 'act', `wrote before looking (${name})`, now)
      /* any first successful look moves to recon; the second observation below
         may push it to plan */
      move(state, 'recon', `${name} opened the workspace`, now)
      return state.phase
    case 'recon':
      if (name === 'update_plan') return move(state, 'plan', 'the plan is up', now)
      if (isWrite) return move(state, 'act', `the work started (${name})`, now)
      if (state.reads >= 3) return move(state, 'plan', `${state.reads} reads — enough to plan`, now)
      return null
    case 'plan':
      if (name === 'update_plan') return null
      if (isWrite) return move(state, 'act', `the first change (${name})`, now)
      if (name === 'audit') return move(state, 'reflect', 'audit before any change', now)
      return null
    case 'act':
      if (isVerify) return move(state, 'verify', `${name} checked the result`, now)
      if (name === 'audit') return move(state, 'reflect', 'audit closed the run', now)
      return null
    case 'verify':
      if (isVerify && ev.ok) return move(state, 'reflect', 'the check passed', now)
      if (isWrite) return move(state, 'act', 'repairing after the check', now)
      if (name === 'audit') return move(state, 'reflect', 'audit closed the run', now)
      return null
    case 'reflect':
      if (isWrite) return move(state, 'act', 'new work after reflection', now)
      if (isVerify) return move(state, 'verify', 'a new check', now)
      return null
  }
}

/** true when this run changed something and never proved it works */
export function missingEvidence(state: CycleState): boolean {
  return state.writes > 0 && state.lastVerifyOkAt < state.lastWriteAt
}

/** the one turn the stop gate adds when a run tries to finish on a claim */
export const EVIDENCE_NUDGE =
  'You changed files but never checked them, so "done" is a claim, not a result. ' +
  'Run the project\'s own check now (run_verification), read the failure if it fails, fix it, and run it again. ' +
  'Then state what passed and what did not. Do not answer with a summary before you do.'

/** what the plan looks like right now — the phase text depends on it */
export interface PlanState {
  steps: number
  open: number
}

/** what the model is told about the phase it is actually in */
export function phaseBlock(state: CycleState, plan: PlanState = { steps: 0, open: 0 }): string {
  const common =
    '\n\n--- execution cycle ---\n' +
    `Phase: ${state.phase} (step ${state.step} · ${state.reads} read(s) · ${state.writes} write(s) · ${state.verifications} check(s)).\n`
  switch (state.phase) {
    case 'intake':
      return (
        common +
        'Start by looking. graph_map first on an unfamiliar project — it answers "what is this made of" ' +
        'without reading files. Do not write anything yet.'
      )
    case 'recon':
      return (
        common +
        'Reconnaissance. Build the map before the opinion: project_overview and graph_map, then read only the ' +
        'files the graph marks as connected. graph_neighbors answers "who imports this" without a grep.'
      )
    case 'plan':
      /* A plan that already exists is not an invitation to write it again: the
         observed loop was five update_plan calls while the project stayed
         untouched. Once the steps are up, the phase asks for the change. */
      if (plan.steps > 0) {
        return (
          common +
          `The plan is written (${plan.steps} step(s), ${plan.open} still open). Do not write another plan — ` +
          'a second plan is a wasted step and the work does not move. Make the change now: write_file, ' +
          'edit_file or propose_changes, in one call when it spans files, then run_verification. ' +
          'Resend the same steps with new statuses only when progress actually happens.'
        )
      }
      return (
        common +
        'Plan. Write the steps with update_plan: each step names the files it will touch and its done_when. ' +
        'A step you cannot verify is not a step.'
      )
    case 'act':
      return (
        common +
        'Act. Make the smallest change that moves a step, in one propose_changes call when it spans files. ' +
        'Do not re-read a file the graph already described unless you are about to edit it.'
      )
    case 'verify':
      return (
        common +
        'Verify. The change is not real until the project says so: run_verification, and read the first error ' +
        'instead of the whole log. security_scan on anything that touches input, auth or the network.'
      )
    case 'reflect':
      return (
        common +
        'Reflect. Say what changed, what passed, and what remains. If a check failed and you have not fixed it, ' +
        'go back to act — do not describe a failure as success.'
      )
  }
}

/** the payload the interface folds into a cycle card */
export function cyclePayload(state: CycleState, from?: Phase): Record<string, unknown> {
  const last = state.history[state.history.length - 1]
  return {
    phase: state.phase,
    from: from ?? state.previous,
    reason: last?.reason ?? '',
    step: state.step,
    reads: state.reads,
    writes: state.writes,
    checks: state.verifications,
    failures: state.failures,
    phases: PHASES,
  }
}
