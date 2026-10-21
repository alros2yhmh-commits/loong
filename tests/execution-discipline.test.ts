/* ---------------------------------------------------------------------------
   Execution discipline — the two stops that hid themselves.

   Evidence this exists: a real run spent 288 tool calls refusing the same
   imprecise oldText on one file and then ended "RUN FAILED" at the 40-step
   budget, with nothing in the interface saying either thing. These tests hold
   the three contracts that came out of it: the budget is an instruction, the
   refusal shapes are recognised, and the stop reasons are classified.
   --------------------------------------------------------------------------- */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { causeOf, editBudgetMessage, EDIT_REFUSAL } from '../server/agent.ts'

test('the edit budget message is an instruction, not another hint', () => {
  const msg = editBudgetMessage('src/app.ts', 3)
  assert.match(msg, /STOP editing/)
  assert.match(msg, /read_file/)
  assert.match(msg, /src\/app\.ts/)
  assert.match(msg, /3 edits/)
})

test('the refusal shapes the edit engine actually emits are recognised', () => {
  /* the three real strings from server/edits.ts */
  assert.ok(EDIT_REFUSAL.test('edit 1: the exact text was not found. The closest line is 12: "const a = 1" — read the file again'))
  assert.ok(EDIT_REFUSAL.test('edit 2: that text appears 3 times (lines 2, 4, 6). Include more surrounding context'))
  assert.ok(EDIT_REFUSAL.test('edit 1 and edit 2 overlap — the same text cannot be replaced twice in one batch.'))
  /* an ordinary successful edit is not a refusal */
  assert.ok(!EDIT_REFUSAL.test('Edited src/app.ts (3 replacements)'))
})

test('a step-budget stop is classified as its own reason, not "internal"', () => {
  assert.equal(causeOf('stopped at the 40-step budget'), 'steps')
  assert.equal(causeOf('step limit reached'), 'steps')
  assert.equal(causeOf('the run hit the step budget'), 'steps')
})

test('a security-gate stop is classified as its own reason', () => {
  assert.equal(causeOf('the security gate found a critical finding'), 'security')
  assert.equal(causeOf('security scan blocked the run'), 'security')
})

test('the old classifications did not move', () => {
  assert.equal(causeOf('402 out of credit'), 'credit')
  assert.equal(causeOf('429 rate limit'), 'provider')
  assert.equal(causeOf('the model fell into a repetition loop'), 'repetition')
  assert.equal(causeOf(null), 'internal')
})

test('no console window is left un-hidden on Windows', async () => {
  /* the where.exe probe had stdio:ignore but no windowsHide — stdio only
     silences the child, the console still opens and flashes */
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../server/tools.ts', import.meta.url), 'utf8')
  const at = src.indexOf('execFileSync(process.platform')
  assert.ok(at > 0, 'the ripgrep probe must still exist')
  const block = src.slice(at, at + 400)
  assert.ok(block.includes('windowsHide: true'), 'the probe must hide its console')
})

test('the headless CLI refuses a task-less run with a usage line', async () => {
  /* a benchmark harness parses stdout; a missing --task must be exit 2 and a
     usage line on stderr, never a silent half-run */
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const r = await run(
    process.execPath,
    ['--experimental-strip-types', 'server/start.ts', 'run'],
    { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), windowsHide: true },
  ).then(
    () => ({ code: 0, stderr: '' }),
    (e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? '' }),
  )
  assert.equal(r.code, 2)
  assert.match(r.stderr, /usage: loong-agent run --task/)
})

test('a hand-picked paid model is never overruled by the free fallback chain', async () => {
  const { mayFallBackFor } = await import('../server/agent.ts')
  /* a decision stays a decision */
  assert.equal(mayFallBackFor('stepfun/step-5-preview', 'openrouter'), false)
  assert.equal(mayFallBackFor('deepseek/deepseek-v4.1-flash', 'openrouter'), false)
  assert.equal(mayFallBackFor('gemini-3-flash-preview', 'google'), false)
  /* a free quota is a busy resource, not a dead app */
  assert.equal(mayFallBackFor('cohere/north-mini-code:free', 'openrouter'), true)
  assert.equal(mayFallBackFor('qwen3:8b', 'ollama'), true)
})
