import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuditTool, createPlanTool, type Audit, type Plan } from '../server/tools.ts'

/* ---------------------------------------------------------------------------
   Phase 5 — the bar and the receipt.

   A plan that names no reference is a to-do list. An audit that cannot say
   "not met" is a success badge. These tests pin both: the plan carries the bar
   and the criteria, and the audit refuses to bless an unmet criterion.
   --------------------------------------------------------------------------- */

/* the tool writes its result through a callback; a collector array sidesteps
   the closure-narrowing blind spot (`let x: T | null = null` stays `null` in
   the checker's eyes, and `x!` collapses to `never`) */
function collector<T>(): { items: T[]; push: (v: T) => void } {
  const items: T[] = []
  return { items, push: (v) => void items.push(v) }
}

test('the plan carries the reference and the acceptance criteria', async () => {
  const saved = collector<Plan>()
  const tool = createPlanTool(saved.push)

  await tool.execute!(
    {
      task: 'rebuild the command palette',
      reference: 'Linear command palette',
      done_when: ['⌘K opens it', 'every action is reachable'],
      steps: [{ description: 'read the current palette', status: 'pending' }],
    },
    {} as never,
  )

  assert.equal(saved.items.length, 1)
  assert.equal(saved.items[0].reference, 'Linear command palette')
  assert.deepEqual(saved.items[0].doneWhen, ['⌘K opens it', 'every action is reachable'])
})

test('a plan without a reference still works — the field is optional', async () => {
  const saved = collector<Plan>()
  const tool = createPlanTool(saved.push)
  await tool.execute!(
    { task: 'small fix', steps: [{ description: 'do it', status: 'pending' }] },
    {} as never,
  )
  assert.equal(saved.items[0].reference, undefined)
  assert.equal(saved.items[0].doneWhen, undefined)
})

test('the audit records the verdict and tells the agent to keep working', async () => {
  const recorded = collector<Audit>()
  const tool = createAuditTool(recorded.push)

  const out = await tool.execute!(
    {
      verdict: 'partial',
      items: [
        { criterion: 'tests pass', met: false, evidence: 'npm test: 1 failing' },
        { criterion: 'the page renders', met: true, evidence: 'screenshot shot-1.png' },
      ],
      note: 'the failing test needs the old fixture',
    },
    {} as never,
  )

  assert.equal(recorded.items.length, 1)
  assert.equal(recorded.items[0].verdict, 'partial')
  assert.equal(recorded.items[0].items.length, 2)
  assert.match(String(out), /not met/i)
  assert.match(String(out), /do not claim/i)
})

test('a clean audit is allowed to say done', async () => {
  const tool = createAuditTool(() => {})
  const out = await tool.execute!(
    {
      verdict: 'met',
      items: [{ criterion: 'build passes', met: true, evidence: 'tsc --noEmit: clean' }],
    },
    {} as never,
  )
  assert.match(String(out), /may say the job is done/i)
})
