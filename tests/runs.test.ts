import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BaseEvent } from '@ag-ui/core'
import { RunStore } from '../server/runs.ts'

const event = (input: Record<string, unknown>) => input as unknown as BaseEvent
const input = { threadId: 'thread', workspace: '/project', provider: 'custom', selectedModel: 'fixed', mode: 'agent', trust: 'auto' }

test('durable events replay after a cursor and subscriptions never execute work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-runs-'))
  try {
    const store = new RunStore(directory)
    const run = store.create(input)
    let notifications = 0
    const detach = store.subscribe(run.id, () => notifications++)
    store.append(run.id, event({ type: 'RUN_STARTED' }))
    store.append(run.id, event({ type: 'TOOL_CALL_START', toolCallId: 'a', toolCallName: 'write_file' }))
    detach()
    store.append(run.id, event({ type: 'TOOL_CALL_RESULT', toolCallId: 'a', content: 'written' }))
    assert.equal(notifications, 2)
    assert.deepEqual(store.events(run.id, 1).map((item) => item.sequence), [2, 3])
    assert.equal(store.get(run.id)?.settled, false)
    store.append(run.id, event({ type: 'RUN_FINISHED', result: { status: 'partial', model: 'actual' } }))
    store.settle(run.id)
    const restored = new RunStore(directory)
    assert.equal(restored.get(run.id)?.status, 'partial')
    assert.equal(restored.get(run.id)?.actualModel, 'actual')
    assert.equal(restored.events(run.id).length, 4)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('a restarted process blocks unknown side effects instead of silently replaying', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-interrupted-'))
  try {
    const store = new RunStore(directory)
    const run = store.create(input)
    store.append(run.id, event({ type: 'TOOL_CALL_START', toolCallId: 'external', toolCallName: 'shell' }))
    store.checkpoint(run.id, [{ role: 'user', content: 'Perform the task without repeating delivery.' }])
    const restarted = new RunStore(directory)
    const recovered = restarted.get(run.id)
    assert.equal(recovered?.status, 'blocked')
    assert.equal(recovered?.settled, true)
    assert.equal(recovered?.sequence, 1)
    assert.match(recovered?.reason ?? '', /not replayed/)
    assert.match(JSON.stringify(restarted.history(run.id)), /without repeating delivery/)
    assert.equal(restarted.get('../outside'), null)
    assert.equal(readFileSync(join(directory, run.id, 'run.json'), 'utf8').includes('apiKey'), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
