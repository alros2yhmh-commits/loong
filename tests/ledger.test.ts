import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isContinuation, ledgerBlock, readLedger, writeLedger } from '../server/ledger.ts'
import type { Plan } from '../server/tools.ts'

const plan = (open: boolean): Plan => ({
  task: 'Finish the task app',
  steps: [
    { description: 'Build the list view', status: 'done' },
    { description: open ? 'Add the board view' : 'Add the board view', status: open ? 'pending' : 'done' },
  ],
  updatedAt: Date.now(),
})

test('the ledger keeps the open steps, files and checks of the last run', () => {
  const threadId = 'ledger-roundtrip'
  writeLedger({
    threadId,
    task: 'Continue working on the project',
    plan: plan(true),
    files: ['src/App.tsx', 'src/types.ts'],
    writes: 0,
    checks: 2,
    failures: 0,
    outcome: 'stopped-short',
    note: 'I read the files.',
  })

  const ledger = readLedger(threadId)
  assert.ok(ledger, 'the ledger did not come back')
  assert.deepEqual(ledger.openSteps, ['Add the board view'])
  assert.deepEqual(ledger.files, ['src/App.tsx', 'src/types.ts'])
  assert.equal(ledger.outcome, 'stopped-short')

  const block = ledgerBlock(ledger)
  assert.match(block, /Open plan steps \(1\): 1\) Add the board view/)
  assert.match(block, /Outcome: stopped short/)
  assert.match(block, /do not re-read the project/i)
  assert.doesNotMatch(block, /Outcome: completed/)
})

test('a finished plan says so, and the block stops claiming open work', () => {
  const threadId = 'ledger-complete'
  writeLedger({
    threadId,
    task: 'Build it',
    plan: plan(false),
    files: ['src/App.tsx'],
    writes: 3,
    checks: 3,
    failures: 0,
    outcome: 'completed',
    note: 'All checks passed.',
  })
  const ledger = readLedger(threadId)
  assert.ok(ledger)
  assert.deepEqual(ledger.openSteps, [])
  const block = ledgerBlock(ledger)
  assert.match(block, /every step is marked done/)
  assert.match(block, /Outcome: completed/)
})

test('a missing ledger is null, and an empty one produces no block', () => {
  assert.equal(readLedger('never-written-thread'), null)
  assert.equal(ledgerBlock(null), '')
})

test('the ledger names the done steps and the steps the run spent', () => {
  const threadId = 'ledger-resume'
  writeLedger({
    threadId,
    task: 'The 49-question checkup',
    plan: plan(true),
    files: ['submit.js'],
    writes: 2,
    checks: 0,
    failures: 0,
    steps: 40,
    outcome: 'failed',
    note: 'Section 1 claimed done.',
  })
  const ledger = readLedger(threadId)
  assert.ok(ledger)
  assert.equal(ledger.steps, 40)
  const block = ledgerBlock(ledger)
  assert.match(block, /Steps the last run spent: 40/)
  assert.match(block, /Steps already done \(do not redo them\): 1\) Build the list view/)
  assert.match(block, /Start from the first open step/)
  assert.match(block, /do not re-fetch or re-download/)
})

test('continue in either language inherits the open plan', () => {
  for (const text of [
    'Continue working on the existing project',
    'resume where you left off',
    'اكمل',
    'كمل الشغل',
    'استمر',
  ]) {
    assert.equal(isContinuation(text), true, text)
  }
  assert.equal(isContinuation('what does this function do?'), false)
  assert.equal(isContinuation('اشرح لي الكود'), false)
})
