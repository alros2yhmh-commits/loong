import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { runAgent } from '../server/agent.ts'
import { currentRunId, runWithRunId } from '../server/run-context.ts'

/* ---------------------------------------------------------------------------
   Two runs at once.

   The server always could run two requests in parallel; the things that broke
   were subtler. The journal kept one global "current run", so a write from one
   run could be attributed to the other and a rewind would restore the wrong
   files. These tests pin the two properties that make concurrency safe:

   1. Each run keeps its own async context, so `currentRunId()` is right inside
      a tool no matter what else is in flight.
   2. Aborting one run does not touch the other.
   --------------------------------------------------------------------------- */

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const stop = { unified: 'stop' as const, raw: 'stop' }

function slowModel(text: string, chunkDelayInMs: number): MockLanguageModelV4 {
  const chunks = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    ...[...text].map((ch) => ({ type: 'text-delta', id: 't1', delta: ch })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: stop, usage },
  ]
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-1',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: chunks as never[],
        initialDelayInMs: null,
        chunkDelayInMs,
      }),
    }),
  })
}

function recorder() {
  const events: BaseEvent[] = []
  const contexts: (string | null)[] = []
  return {
    events,
    contexts,
    emit: (e: BaseEvent) => {
      events.push(e)
      contexts.push(currentRunId())
    },
    types: () => events.map((e) => e.type),
    text: () =>
      events
        .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
        .map((e) => String((e as unknown as { delta?: string }).delta ?? ''))
        .join(''),
  }
}

test('two runs keep separate contexts and abort independently', async () => {
  const a = recorder()
  const b = recorder()
  const controllerA = new AbortController()

  const runA = runWithRunId('run-a', () =>
    runAgent({
      runId: 'run-a',
      threadId: 'thread-a',
      messages: [{ role: 'user', content: 'a' }],
      config: { provider: 'ollama', model: 'mock' },
      mode: 'agent',
      trust: 'auto',
      model: slowModel('AAAAAAAAAAAAAAAAAAAA', 30),
      emit: a.emit,
      abortSignal: controllerA.signal,
    }),
  )

  const runB = runWithRunId('run-b', () =>
    runAgent({
      runId: 'run-b',
      threadId: 'thread-b',
      messages: [{ role: 'user', content: 'b' }],
      config: { provider: 'ollama', model: 'mock' },
      mode: 'agent',
      trust: 'auto',
      model: slowModel('BBBBBBBBBB', 5),
      emit: b.emit,
    }),
  )

  /* stop A while B is still streaming */
  await new Promise((resolve) => setTimeout(resolve, 50))
  controllerA.abort()

  await Promise.all([runA, runB])

  /* A was stopped; B finished on its own */
  assert.equal(a.types().includes(EventType.RUN_FINISHED), false, 'the aborted run must not report finished')
  assert.equal(b.types().includes(EventType.RUN_FINISHED), true, 'the other run must finish')
  assert.equal(b.text(), 'BBBBBBBBBB')

  /* every event saw the run that produced it, never the other one */
  assert.ok(a.contexts.length > 0)
  assert.ok(b.contexts.length > 0)
  assert.deepEqual([...new Set(a.contexts)], ['run-a'])
  assert.deepEqual([...new Set(b.contexts)], ['run-b'])
})
