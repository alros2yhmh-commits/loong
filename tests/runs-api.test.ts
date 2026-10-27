import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setWorkspace } from '../server/config.ts'
import { app } from '../server/index.ts'
import { runStore } from '../server/runs.ts'
import { pendingApprovals } from '../server/approvals.ts'

async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8_000
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(predicate(), message)
}

async function fixture(run: (root: string, baseUrl: string, requests: () => number) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'loong-background-'))
  setWorkspace(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test acceptance.mjs' } }))
  writeFileSync(join(root, 'acceptance.mjs'), "import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('proof.txt','utf8'),'written once')")
  let requests = 0
  const provider = createServer(async (_request, response) => {
    requests++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta: unknown, reason: string | null = null) => response.write(`data: ${JSON.stringify({ id: `response-${requests}`, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`)
    if (requests === 1) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: 'write-proof', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'proof.txt', content: 'written once' }) } }] })
      send({}, 'tool_calls')
    } else {
      await new Promise((resolve) => setTimeout(resolve, 150))
      send({ role: 'assistant', content: 'The requested file was created.' })
      send({}, 'stop')
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const port = (provider.address() as { port: number }).port
  try { await run(root, `http://127.0.0.1:${port}/v1`, () => requests) }
  finally { await new Promise<void>((resolve) => provider.close(() => resolve())); rmSync(root, { recursive: true, force: true }) }
}

async function start(baseUrl: string, trust = 'auto', requestId = randomUUID(), threadId = randomUUID()) {
  const response = await app.request('/api/runs/start', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, threadId, trust, mode: 'agent', route: 'manual',
      messages: [{ role: 'user', content: 'Create proof.txt containing written once and verify it.' }],
      config: { provider: 'custom', model: 'fixture-model', baseUrl, apiKey: 'test-only-placeholder' } }) })
  assert.equal(response.status, 202)
  return await response.json() as { run: { id: string; status: string } }
}

test('disconnect and event replay keep one real task running without repeating its write', async () => {
  await fixture(async (root, baseUrl, count) => {
    const requestId = randomUUID(), threadId = randomUUID()
    const { run } = await start(baseUrl, 'auto', requestId, threadId)
    const repeated = await start(baseUrl, 'auto', requestId, threadId)
    assert.equal(repeated.run.id, run.id, 'retrying acceptance must be idempotent')
    const subscription = await app.request(`/api/runs/${run.id}/events`)
    const reader = subscription.body!.getReader()
    await reader.read()
    await reader.cancel()
    await until(() => runStore.get(run.id)?.settled === true, 'background task should settle after subscriber disconnect')
    assert.equal(runStore.get(run.id)?.status, 'completed')
    assert.equal(readFileSync(join(root, 'proof.txt'), 'utf8'), 'written once')
    assert.equal(count(), 2, 'one tool request and one model answer; reconnect must not rerun the model')
    const events = runStore.events(run.id)
    assert.equal(events.filter((event) => event.type === 'TOOL_CALL_START').length, 1)
    const replay = await app.request(`/api/runs/${run.id}/events?after=${events[0].sequence}`)
    const text = await replay.text()
    assert.match(text, /loong.settled/)
    assert.equal(text.includes(`id: ${events[0].sequence}\n`), false)
    assert.equal(JSON.stringify(runStore.get(run.id)).includes('test-only-placeholder'), false)
    const other = mkdtempSync(join(tmpdir(), 'loong-other-project-'))
    setWorkspace(other)
    const refused = await app.request('/api/checkpoints/rewind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.id }) })
    assert.equal(refused.status, 409, 'undo must not cross project boundaries')
    assert.equal(existsSync(join(root, 'proof.txt')), true)
    setWorkspace(root)
    rmSync(other, { recursive: true, force: true })
    const undo = await app.request('/api/checkpoints/rewind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.id }) })
    assert.equal(undo.status, 200)
    const undone = await undo.json() as { ok: boolean; removed: number; conflicts: unknown[] }
    assert.equal(undone.ok, true)
    assert.equal(undone.removed, 1)
    assert.equal(existsSync(join(root, 'proof.txt')), false)
    assert.ok(runStore.events(run.id).some((event) => (event as unknown as { name?: string }).name === 'loong.rewound'))
  })
})

test('explicit cancel resolves a parked approval without writing or leaving an orphan', async () => {
  await fixture(async (root, baseUrl) => {
    const { run } = await start(baseUrl, 'ask')
    await until(() => pendingApprovals().length > 0, 'write should wait for authorization')
    const requested = pendingApprovals()[0].id
    const response = await app.request(`/api/runs/${run.id}/cancel`, { method: 'POST' })
    assert.equal(response.status, 200)
    await until(() => runStore.get(run.id)?.settled === true, 'cancel should settle the parked task')
    assert.equal(runStore.get(run.id)?.status, 'cancelled')
    assert.equal(existsSync(join(root, 'proof.txt')), false)
    assert.equal(pendingApprovals().length, 0)
    assert.ok(runStore.events(run.id).some((event) => {
      const custom = event as unknown as { name?: string; value?: { id?: string } }
      return custom.name === 'loong.approval_resolved' && custom.value?.id === requested
    }), 'approval resolution must use the same broker UUID')
  })
})
