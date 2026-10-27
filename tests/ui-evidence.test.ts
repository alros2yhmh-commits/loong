import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Block } from '../src/lib/blocks.ts'
import { checkEvidence, outcomeLabel, taskBlocks, taskObjective, terminalEvidence } from '../src/lib/evidence.ts'

const user = (id: string): Block => ({ k: 'user', id, text: 'Implement and verify', at: 1 })
const check = (id: string, ok = true): Block => ({ k: 'check', id, label: 'npm test', ok, at: 2 })
const tool = (id: string, name: string, ok = true, live = false): Block => ({
  k: 'tool', id, tool: name, wire: name, title: name, ok, live, at: 3,
})

test('a successful old check is outdated after a later edit, even with equal event timestamps', () => {
  const events = [user('a'), check('before'), tool('edit', 'propose_changes'), check('after')]
  assert.deepEqual(checkEvidence(events).map((entry) => ({ id: entry.id, stale: entry.stale })), [
    { id: 'before', stale: true }, { id: 'after', stale: false },
  ])
})

test('failed or pending edits and reads do not make a check stale', () => {
  const evidence = checkEvidence([user('a'), check('test'), tool('read', 'read_file'), tool('bad', 'edit_file', false), tool('pending', 'write_file', true, true)])
  assert.equal(evidence[0].stale, false)
})

test('evidence from earlier requests is not attributed to the current request', () => {
  const events = [user('old'), check('old-check'), tool('old-command', 'shell'), user('new'), tool('new-command', 'terminal')]
  assert.equal(checkEvidence(events).length, 0)
  assert.deepEqual(terminalEvidence(events).map((entry) => entry.id), ['new-command'])
  assert.equal(taskBlocks(events)[0].id, 'new')
})

test('partial and blocked outcomes are distinct from successful completion', () => {
  assert.equal(outcomeLabel('partial'), 'Partially completed')
  assert.equal(outcomeLabel('blocked'), 'Needs attention')
  assert.equal(outcomeLabel(null), 'Ready')
  assert.notEqual(outcomeLabel('partial'), outcomeLabel('completed'))
})


test('Arabic and English continuation messages keep the substantive objective visible', () => {
  const original: Block = { k: 'user', id: 'original', text: 'أنشئ تطبيق المهام مع اختبارات', at: 1 }
  const followup: Block = { k: 'user', id: 'continue', text: 'أكمل', at: 2 }
  assert.equal(taskObjective([original, followup])?.id, 'original')
  const changed: Block = { k: 'user', id: 'new-task', text: 'Add persistence to the task app', at: 3 }
  assert.equal(taskObjective([original, followup, changed])?.id, 'new-task')
  assert.equal(taskObjective([]), undefined)
})


test('a persisted rewind makes earlier checks stale even without a subsequent tool call', () => {
  const rewind: Block = { k: 'notice', id: 'rewind-run1', text: 'Previous checks describe the earlier revision.', at: 4 }
  const ordinary: Block = { k: 'notice', id: 'notice-normal', text: 'Rate limit retry', at: 4 }
  assert.equal(checkEvidence([user('a'), check('test'), rewind])[0].stale, true)
  assert.equal(checkEvidence([user('a'), check('test'), ordinary])[0].stale, false)
  assert.equal(checkEvidence([user('a'), rewind, check('new-check')])[0].stale, false)
})
