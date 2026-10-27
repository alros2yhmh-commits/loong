import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { runAgent } from '../server/agent.ts'
import { resolveApproval, pendingApprovals } from '../server/approvals.ts'
import { setWorkspace } from '../server/config.ts'
import { TOOLS } from '../server/tools.ts'
import { writeLedger } from '../server/ledger.ts'

/* A run has no default root any more: it names one. These loop tests work on the
   repository itself, so they name it explicitly. */
setWorkspace(process.cwd())

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
  const file = probe('APPROVAL_PROBE.txt')
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
  file.cleanup()
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
  assert.match(result.content, /denied permission|permission was not granted/i)
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

/* ---------------------------------------------------------------------------
   The completion gates.

   The session that motivated these: three runs in a row read the project,
   wrote nothing, and the last one closed as "completed" with no answer at all
   because the provider returned empty streams and the retry loop ran out.
   --------------------------------------------------------------------------- */

test('a run that only ever gets empty streams fails instead of completing', async () => {
  const sink = collect()
  const empty = [
    { type: 'stream-start', warnings: [] },
    { type: 'finish', finishReason: stop, usage },
  ]

  await runAgent({
    runId: 'r-empty',
    threadId: 'th-empty',
    messages: [{ role: 'user', content: 'say something' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([empty]),
    route: 'manual',
    retryBackoffMs: [1, 1],
    emit: sink.emit,
  })

  const stops = sink.events.filter(
    (e) => e.type === EventType.CUSTOM && (e as unknown as { name: string }).name === 'loong.stop',
  )
  assert.equal(stops.length, 0, 'an empty run still reported a clean stop')
  const failed = sink.events.find((e) => e.type === EventType.RUN_ERROR) as unknown as { message: string }
  assert.ok(failed, 'no RUN_ERROR: the empty run looked successful')
  assert.match(failed.message, /empty|nothing|no answer/i)
})

test('an open plan and no writes stops short, and the plan gate asks once', async () => {
  const sink = collect()
  const planCall = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'p1',
      toolName: 'update_plan',
      input: JSON.stringify({
        task: 'Finish the task app',
        steps: [{ description: 'Add the board view', status: 'pending' }],
      }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]
  const lookCall = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'l1',
      toolName: 'list_dir',
      input: JSON.stringify({ path: '.' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]

  await runAgent({
    runId: 'r-plan-gate',
    threadId: 'th-plan-gate',
    messages: [{ role: 'user', content: 'اكمل' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([planCall, lookCall, textStream('I read the files.')]),
    route: 'manual',
    retryBackoffMs: [1, 1],
    emit: sink.emit,
  })

  const gate = sink.events.find(
    (e) =>
      e.type === EventType.CUSTOM &&
      (e as unknown as { name: string }).name === 'loong.notice' &&
      /plan gate/i.test((e as unknown as { value?: { text?: string } }).value?.text ?? ''),
  )
  assert.ok(gate, 'the plan gate never fired')

  const stopEvent = sink.events.find(
    (e) => e.type === EventType.CUSTOM && (e as unknown as { name: string }).name === 'loong.stop',
  ) as unknown as { value: { reason: string; openSteps?: number } }
  assert.ok(stopEvent, 'no stop event')
  assert.equal(stopEvent.value.reason, 'stopped-short', 'an idle reading run claimed completion')
  assert.equal(stopEvent.value.openSteps, 1)
})

test('the next run in a thread is given the state, not the whole project again', async () => {
  writeLedger({
    threadId: 'th-ledger-inject',
    task: 'Build the task app',
    plan: {
      task: 'Build the task app',
      steps: [{ description: 'Add localStorage persistence', status: 'pending' }],
      updatedAt: Date.now(),
    },
    files: ['src/App.tsx'],
    writes: 1,
    checks: 2,
    failures: 0,
    outcome: 'stopped-short',
    note: 'The list view works; persistence is next.',
  })

  let seen = ''
  const m = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-1',
    doStream: async (options: unknown) => {
      seen = JSON.stringify(options)
      return {
        stream: simulateReadableStream({
          chunks: textStream('Continuing with persistence.') as never[],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      } as never
    },
  })

  const sink = collect()
  await runAgent({
    runId: 'r-ledger',
    threadId: 'th-ledger-inject',
    messages: [{ role: 'user', content: 'Continuing with the task app' }],
    config: { provider: 'ollama', model: 'mock' },
    model: m,
    route: 'manual',
    retryBackoffMs: [1, 1],
    emit: sink.emit,
  })

  assert.match(seen, /last run on this thread/)
  assert.match(seen, /Open plan steps \(1\): 1\) Add localStorage persistence/)
  assert.match(seen, /Files already changed last run: src\/App\.tsx/)
})

test('a continue turn cannot close while the inherited plan is still open', async () => {
  writeLedger({
    threadId: 'th-inherit',
    task: 'Build the task app',
    plan: {
      task: 'Build the task app',
      steps: [{ description: 'Add localStorage persistence', status: 'pending' }],
      updatedAt: Date.now(),
    },
    files: [],
    writes: 0,
    checks: 0,
    failures: 0,
    outcome: 'stopped-short',
    note: 'read only',
  })

  const lookCall = [
    { type: 'stream-start', warnings: [] },
    {
      type: 'tool-call',
      toolCallId: 'i1',
      toolName: 'list_dir',
      input: JSON.stringify({ path: '.' }),
    },
    { type: 'finish', finishReason: toolCalls, usage },
  ]
  const sink = collect()
  await runAgent({
    runId: 'r-inherit',
    threadId: 'th-inherit',
    messages: [{ role: 'user', content: 'اكمل' }],
    config: { provider: 'ollama', model: 'mock' },
    model: model([lookCall, textStream('I read the files.')]),
    route: 'manual',
    retryBackoffMs: [1, 1],
    emit: sink.emit,
  })

  const gate = sink.events.find(
    (e) =>
      e.type === EventType.CUSTOM &&
      (e as unknown as { name: string }).name === 'loong.notice' &&
      /plan gate/i.test((e as unknown as { value?: { text?: string } }).value?.text ?? ''),
  )
  assert.ok(gate, 'the inherited plan was not enforced')
  const stopEvent = sink.events.find(
    (e) => e.type === EventType.CUSTOM && (e as unknown as { name: string }).name === 'loong.stop',
  ) as unknown as { value: { reason: string } }
  assert.equal(stopEvent?.value.reason, 'stopped-short')
})

/* ---------------------------------------------------------------------------
   The phase the model is told it is in.

   A system string is built once per stream. Before this test the phase block
   lived in it, so a twelve-step run read "Phase: intake, step 0, do not write
   anything yet" on every step — and the model, obeying, only read. The phase
   now goes through prepareStep, and this test pins that.
   --------------------------------------------------------------------------- */

const readCall = (id: string) => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: id, toolName: 'list_dir', input: JSON.stringify({ path: '.' }) },
  { type: 'finish', finishReason: toolCalls, usage },
]

test('the phase block is rebuilt for every step instead of frozen at intake', async () => {
  const sink = collect()
  const systems: string[] = []
  const parts = [readCall('r1'), readCall('r2'), readCall('r3'), textStream('Read it.')]
  let call = 0
  const recorder = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-1',
    doStream: async (options: unknown) => {
      const prompt = (options as { prompt?: { role?: string; content?: unknown }[] }).prompt ?? []
      const sys = prompt.find((m) => m.role === 'system')
      const content = sys?.content
      systems.push(
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? (content as { text?: string }[]).map((p) => p.text ?? '').join('')
            : '',
      )
      const chunk = parts[Math.min(call, parts.length - 1)] as never[]
      call += 1
      return {
        stream: simulateReadableStream({ chunks: chunk, initialDelayInMs: null, chunkDelayInMs: null }),
      } as never
    },
  })

  await runAgent({
    runId: 'r-phase',
    threadId: 'th-phase',
    messages: [{ role: 'user', content: 'look at this project' }],
    config: { provider: 'ollama', model: 'mock' },
    model: recorder,
    emit: sink.emit,
  })

  assert.ok(systems.length >= 4, `expected at least 4 model calls, saw ${systems.length}`)
  /* the first step is intake — the phase is allowed to say "do not write yet" */
  assert.match(systems[0], /Phase: intake/)
  assert.match(systems[0], /step 0/)
  /* the fourth step has read three times: the phase must have moved with it */
  assert.match(systems[3], /Phase: plan/)
  assert.match(systems[3], /step 3 · 3 read\(s\)/)
  assert.doesNotMatch(
    systems[3],
    /Do not write anything yet/,
    'a later step still carried the intake instruction — the phase block is frozen',
  )
})
