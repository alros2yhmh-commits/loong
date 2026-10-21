import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { runAgent } from '../server/agent.ts'
import { resolveApproval, pendingApprovals } from '../server/approvals.ts'
import { TOOLS } from '../server/tools.ts'

/** a test that leaves files in the workspace is a test that will confuse someone */
const probe = (name: string) => ({
  path: name,
  cleanup: () => rmSync(resolve(name), { force: true }),
})

/* ---------------------------------------------------------------------------
   The loop, tested without a model.

   These use the AI SDK's own mock model, so the test is deterministic and does
   not depend on whether some 0.8B model decides to call a tool today. That
   distinction matters: a test that fails because the model was in a mood is a
   test nobody trusts.

   What is covered here is the part that is actually ours — that stream parts
   become the right AG-UI events, in the right order, and that an approval parks
   the run instead of letting it through.
   --------------------------------------------------------------------------- */

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }

/* finishReason is an object in the v4 provider protocol, not a bare string.
   Getting this wrong makes the SDK silently skip tool execution, which is
   exactly the kind of failure that looks like a bug in the loop. */
const stop = { unified: 'stop' as const, raw: 'stop' }
const toolCalls = { unified: 'tool-calls' as const, raw: 'tool_calls' }

function model(parts: unknown[]): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-1',
    doStream: async () => {
      const chunk = parts[Math.min(call, parts.length - 1)] as never[]
      call += 1
      return {
        stream: simulateReadableStream({
          chunks: chunk,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      } as never
    },
  })
}

function collect() {
  const events: BaseEvent[] = []
  return {
    events,
    emit: (e: BaseEvent) => {
      events.push(e)
    },
    types: () => events.map((e) => e.type),
  }
}

const textStream = (text: string) => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: stop, usage },
]

test('a plain answer becomes RUN_STARTED, text events, then RUN_FINISHED', async () => {
  const sink = collect()
  await runAgent({
    runId: 'r1',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([textStream('Hello there.')]),
    emit: sink.emit,
  })

  /* the run announces its trust level first, so the interface can show whether
     the agent will ask before each write or just do the work */
  const trust = sink.events.find(
    (e) =>
      e.type === EventType.CUSTOM &&
      (e as unknown as { name: string }).name === 'loong.trust',
  ) as unknown as { name: string; value: { trust: string }; runId: string }
  assert.equal(trust.name, 'loong.trust')
  assert.equal(trust.value.trust, 'ask')
  assert.equal(trust.runId, 'r1')
  assert.deepEqual(
    sink.events
      .filter((e) => e.type !== EventType.CUSTOM)
      .map((e) => e.type),
    [
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ],
  )

  const content = sink.events.find(
    (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
  ) as unknown as { delta: string }
  assert.equal(content.delta, 'Hello there.')
})

test('every event carries the run and thread id', async () => {
  const sink = collect()
  await runAgent({
    runId: 'run-xyz',
    threadId: 'thread-abc',
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([textStream('ok')]),
    emit: sink.emit,
  })
  for (const e of sink.events) {
    const ev = e as unknown as { runId?: string; threadId?: string }
    assert.equal(ev.runId, 'run-xyz', `${e.type} lost the run id`)
    assert.equal(ev.threadId, 'thread-abc', `${e.type} lost the thread id`)
  }
})

test('a tool call is emitted as START, ARGS, END and then a RESULT', async () => {
  const sink = collect()
  const call = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'c1',
      toolName: 'list_dir',
      input: JSON.stringify({ path: '.' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]

  await runAgent({
    runId: 'r2',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'list the root' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([call, textStream('done')]),
    emit: sink.emit,
  })

  const types = sink.types()
  assert.ok(types.includes(EventType.TOOL_CALL_START), 'no TOOL_CALL_START')
  assert.ok(types.includes(EventType.TOOL_CALL_ARGS), 'no TOOL_CALL_ARGS')
  assert.ok(types.includes(EventType.TOOL_CALL_END), 'no TOOL_CALL_END')
  assert.ok(types.includes(EventType.TOOL_CALL_RESULT), 'no TOOL_CALL_RESULT')

  /* and the order is the order the interface relies on */
  assert.ok(
    types.indexOf(EventType.TOOL_CALL_START) < types.indexOf(EventType.TOOL_CALL_ARGS),
    'args arrived before start',
  )
  assert.ok(
    types.indexOf(EventType.TOOL_CALL_ARGS) < types.indexOf(EventType.TOOL_CALL_RESULT),
    'the result arrived before the arguments',
  )

  /* the tool really ran: the result is a real directory listing */
  const result = sink.events.find(
    (e) => e.type === EventType.TOOL_CALL_RESULT,
  ) as unknown as { content: string }
  assert.ok(result.content.includes('package.json'), 'the listing looks empty')
})

test('a mutating tool parks the run until a human answers', async () => {
  const sink = collect()
  const call = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'w1',
      toolName: 'write_file',
      input: JSON.stringify({ path: 'APPROVAL_PROBE.txt', content: 'probe' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]

  const running = runAgent({
    runId: 'r3',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'write a file' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([call, textStream('written')]),
    emit: sink.emit,
  })

  /* give the loop time to reach the tool and park on it */
  await new Promise((r) => setTimeout(r, 250))

  const pending = pendingApprovals()
  assert.equal(pending.length, 1, 'the run did not park on the approval')
  assert.equal(pending[0].tool, 'write_file')
  assert.equal(pending[0].title, 'APPROVAL_PROBE.txt')

  const requested = sink.events.find(
    (e) => e.type === EventType.CUSTOM && (e as unknown as { name: string }).name === 'loong.approval_requested',
  )
  assert.ok(requested, 'the interface was never told about the approval')

  /* still parked: no result has been emitted */
  assert.ok(
    !sink.types().includes(EventType.TOOL_CALL_RESULT),
    'the tool ran before it was approved',
  )

  assert.equal(resolveApproval(pending[0].id, true), true)
  await running

  assert.ok(
    sink.types().includes(EventType.TOOL_CALL_RESULT),
    'the tool did not run after approval',
  )
})

test('a denied tool does not run, and the model is told not to retry', async () => {
  const sink = collect()
  const call = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'w2',
      toolName: 'write_file',
      input: JSON.stringify({ path: 'DENIED_PROBE.txt', content: 'nope' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]

  const running = runAgent({
    runId: 'r4',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'write a file' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([call, textStream('understood')]),
    emit: sink.emit,
  })

  await new Promise((r) => setTimeout(r, 250))
  const pending = pendingApprovals()
  assert.equal(pending.length, 1, 'the run did not park on the approval')
  resolveApproval(pending[0].id, false)
  await running

  const result = sink.events.find(
    (e) => e.type === EventType.TOOL_CALL_RESULT,
  ) as unknown as { content: string }
  assert.ok(result, 'no result was emitted for the denial')
  assert.match(result.content, /denied permission/i)
  assert.match(result.content, /do not retry/i)
})

test('resolveApproval refuses an id it does not know', () => {
  assert.equal(resolveApproval('not-a-real-id', true), false)
})

test('full trust writes without parking, and says so at the start', async () => {
  const sink = collect()
  const file = probe('TRUST_PROBE.txt')
  const call = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'w3',
      toolName: 'write_file',
      input: JSON.stringify({ path: 'TRUST_PROBE.txt', content: 'trusted' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]

  try {
    await runAgent({
      runId: 'r8',
      threadId: 'th1',
      messages: [{ role: 'user', content: 'write it' }],
      config: { provider: 'ollama', model: 'mock' },
      trust: 'auto',
      model: model([call, textStream('written')]),
      emit: sink.emit,
    })

    /* the run announced full trust */
    const announced = sink.events.find(
      (e) =>
        e.type === EventType.CUSTOM &&
        (e as unknown as { name: string }).name === 'loong.trust',
    ) as unknown as { value: { trust: string } }
    assert.equal(announced.value.trust, 'auto')

    /* nothing parked: the write was not gated */
    assert.equal(pendingApprovals().length, 0, 'full trust still parked on an approval')

    /* and the tool actually ran and wrote the file */
    const result = sink.events.find(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    ) as unknown as { content: string }
    assert.ok(result, 'the write produced no result')
    assert.doesNotMatch(result.content, /denied/i)
    assert.ok(existsSync(resolve('TRUST_PROBE.txt')), 'the file was not written')
  } finally {
    file.cleanup()
  }
})

test('an unknown stream part fails the run cleanly instead of throwing', async () => {
  const sink = collect()
  await runAgent({
    runId: 'r5',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'some-future-part', payload: 1 },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'survived' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: stop, usage },
      ],
    ]),
    emit: sink.emit,
  })
  /* The SDK's stream parser refuses a chunk type it does not recognise, so the
     run cannot continue past it. What matters is that the refusal reaches the
     interface as RUN_ERROR rather than escaping as an unhandled exception that
     leaves the reader with a dead stream and no explanation. */
  const err = sink.events.find(
    (e) => e.type === EventType.RUN_ERROR,
  ) as unknown as { message: string }
  assert.ok(err, 'an unknown chunk produced no RUN_ERROR')
  assert.match(err.message, /unknown|chunk/i)
})

test('a model error becomes RUN_ERROR, not a thrown exception', async () => {
  const sink = collect()
  await runAgent({
    runId: 'r6',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([[{ type: 'error', error: new Error('the model exploded') }]]),
    emit: sink.emit,
  })
  const err = sink.events.find((e) => e.type === EventType.RUN_ERROR) as unknown as {
    message: string
  }
  assert.ok(err, 'no RUN_ERROR was emitted')
  assert.match(err.message, /exploded/)
})

test('an unreachable provider produces a message a human can act on', async () => {
  const sink = collect()
  await runAgent({
    runId: 'r7',
    threadId: 'th1',
    messages: [{ role: 'user', content: 'hi' }],
    config: { provider: 'anthropic', model: 'x', apiKey: '' },
    emit: sink.emit,
  })
  const err = sink.events.find((e) => e.type === EventType.RUN_ERROR) as unknown as {
    message: string
  }
  assert.ok(err)
  assert.match(err.message, /API key/i)
})

test('the workspace guard is reachable through the real tool', async () => {
  const read = TOOLS.read_file.execute!
  await assert.rejects(
    async () => read({ path: '../../etc/passwd' } as never, {} as never),
    /outside the workspace/i,
  )
})

test('grep on a missing directory reports rather than throws', async () => {
  const grep = TOOLS.grep.execute!
  const out = (await grep({ pattern: 'zzz', path: 'does-not-exist' } as never, {} as never)) as string
  assert.match(out, /No matches|Refused/)
})
