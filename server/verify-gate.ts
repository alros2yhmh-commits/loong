import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerifyCommand } from './edits.ts'

/* ---------------------------------------------------------------------------
   The verify gate.

   A run that wrote code and never checked it is claiming success without proof.
   The old shape ran the project's own command once, at the very end, inside the
   `finally` block — after the model had stopped. The failure was printed into
   the transcript, where the user could read it and the model could not: the run
   was already over, so nothing could act on it.

   This is the fix. The check runs before the run is allowed to end, and a
   failure goes back to the model as a turn. Bounded, because an unbounded repair
   loop spends the user's credits on a model that is not converging — one round,
   then the truth is reported either way.

   The decision is a pure function, so it is testable without a model, a shell or
   a clock. The runner never throws: a check that cannot run is not a failure of
   the user's task.
   --------------------------------------------------------------------------- */

const execAsync = promisify(exec)

/** one repair round. A second one is a model that is not converging. */
export const MAX_REPAIRS = 1
/** a cold gradle build is minutes, not seconds; a check killed at 60s is a lie */
export const CHECK_TIMEOUT_MS = 180_000
/** how much of a failure the model gets: the first error, not the whole log */
const MAX_OUTPUT_LINES = 40
const MAX_OUTPUT_CHARS = 4_000

export interface GateContext {
  /** the files this run wrote — the gate is about what changed */
  changedFiles: string[]
  mode: 'ask' | 'plan' | 'agent'
  /** full trust: the only mode where a check may run unasked */
  autoApprove: boolean
  aborted: boolean
  /** repair rounds already spent on this run */
  repairsDone: number
  verify: VerifyCommand | null
}

export type GateDecision =
  | { action: 'skip'; reason: string }
  | { action: 'check'; verify: VerifyCommand; repair: boolean }

/**
 * Whether to run the project's own check, and whether a failure may be fed back.
 *
 * The order matters: an aborted run is not checked at all (the user said stop),
 * and a run that wrote nothing has nothing to verify — running the suite then
 * would report a pre-existing failure as if this run had caused it.
 */
export function gateDecision(ctx: GateContext): GateDecision {
  if (ctx.aborted) return { action: 'skip', reason: 'the run was stopped' }
  if (ctx.mode !== 'agent') return { action: 'skip', reason: 'checks run in agent mode only' }
  if (!ctx.autoApprove) return { action: 'skip', reason: 'checks run in full trust only' }
  if (ctx.changedFiles.length === 0) return { action: 'skip', reason: 'nothing was written' }
  if (!ctx.verify) return { action: 'skip', reason: 'no build or test command was found' }
  return { action: 'check', verify: ctx.verify, repair: ctx.repairsDone < MAX_REPAIRS }
}

export interface CheckResult {
  ok: boolean
  timedOut: boolean
  output: string
  seconds: number
}

/** run the project's own command. Never throws. */
export async function runProjectCheck(
  verify: VerifyCommand,
  cwd: string,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  const started = Date.now()
  try {
    const { stdout, stderr } = await execAsync(verify.cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    })
    return {
      ok: true,
      timedOut: false,
      output: [stdout, stderr].filter(Boolean).join('\n').trim(),
      seconds: (Date.now() - started) / 1000,
    }
  } catch (err) {
    const e = err as { killed?: boolean; stdout?: string; stderr?: string; message?: string }
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
    return {
      ok: false,
      timedOut: Boolean(e.killed),
      output: output || e.message || 'no output',
      seconds: (Date.now() - started) / 1000,
    }
  }
}

/** the first error lines, not the whole log */
export function firstLines(output: string, lines = MAX_OUTPUT_LINES): string {
  const clipped =
    output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}\n…` : output
  const all = clipped.split('\n')
  return all.length > lines
    ? `${all.slice(0, lines).join('\n')}\n… (${all.length - lines} more lines)`
    : clipped
}

/**
 * What the model is told when the check fails — and what it may not do about it.
 *
 * The last line is the point. A failing test is the one situation where a weak
 * model's cheapest move is to delete the test, and a repair round that ends in
 * `test.skip` is worse than no repair round at all.
 */
export function repairTurn(verify: VerifyCommand, result: CheckResult): string {
  const how = result.timedOut ? `timed out after ${Math.round(result.seconds)}s` : 'FAILED'
  return [
    `[the project's own check ran after your changes and ${how}]`,
    `Command: ${verify.cmd}`,
    '',
    'Output:',
    firstLines(result.output),
    '',
    'Fix the cause, then run the check yourself and report what it printed.',
    'Do not delete or weaken the check, do not skip the failing test, and do not claim it passes without running it.',
  ].join('\n')
}

/** the one line the transcript gets when the check fails for good */
export function failDetail(verify: VerifyCommand, result: CheckResult): string {
  const how = result.timedOut ? `timed out after ${Math.round(result.seconds)}s` : 'FAILED'
  return `Checks: ${verify.label} ${how}.\n${firstLines(result.output, 6)}`
}
