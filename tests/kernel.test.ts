import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { tool } from 'ai'
import { z } from 'zod'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { runKernelPass } from '../server/engine/kernel.ts'
import { claimedDeliveries, deliveryKey, isOutward } from '../server/deliveries.ts'

/* ---------------------------------------------------------------------------
   The kernel, without a model.

   These are the three properties the loop is responsible for, and none of them
   is about the model being clever:

     · independent calls run together, so nine reads cost one step;
     · the step ceiling is a pause with the transcript intact, not a failure;
     · a tool that answers with a picture hands the model a picture.
   --------------------------------------------------------------------------- */

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const stop = { unified: 'stop' as const, raw: 'stop' }
const toolCalls = { unified: 'tool-calls' as const, raw: 'tool_calls' }

function scripted(parts: unknown[][]): MockLanguageModelV4 {
  let call = 0
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-kernel',
    doStream: async () => {
      const chunk = parts[Math.min(call, parts.length - 1)] as never[]
      call += 1
      return {
        stream: simulateReadableStream({ chunks: chunk, initialDelayInMs: null, chunkDelayInMs: null }),
      } as never
    },
  })
}

const call = (id: string, name: string, input: unknown) => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) },
  { type: 'finish', finishReason: toolCalls, usage },
]

const say = (text: string) => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: stop, usage },
]

function toolsFor(log: string[]) {
  const read = (name: string) =>
    tool({
      description: `read ${name}`,
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        log.push(`${name}:${path}`)
        return `contents of ${path}`
      },
    })
  return {
    read_file: read('read_file'),
    list_dir: read('list_dir'),
    write_file: tool({
      description: 'write',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }: { path: string }) => {
        log.push(`write_file:${path}`)
        return 'written'
      },
    }),
  } as never
}

test('independent reads in one step run together, and the loop continues', async () => {
  const log: string[] = []
  const events: BaseEvent[] = []
  const outcome = await runKernelPass({
    runId: 'k1',
    threadId: 't1',
    model: scripted([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_file', input: JSON.stringify({ path: 'one' }) },
        { type: 'tool-call', toolCallId: 'b', toolName: 'read_file', input: JSON.stringify({ path: 'two' }) },
        { type: 'finish', finishReason: toolCalls, usage },
      ],
      say('both read'),
    ]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools: toolsFor(log),
    turns: [{ role: 'user', content: 'read two files' }],
    maxSteps: 8,
    emit: (e) => events.push(e),
    errorRetryable: () => false,
  })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.stepLimit, false)
  assert.equal(outcome.steps, 2, 'two model calls: the tool step, then the answer')
  assert.deepEqual(log, ['read_file:one', 'read_file:two'])
  assert.equal(outcome.text, 'both read')
  /* the transcript keeps the calls AND their answers, or the next pass is blind */
  const assistant = outcome.history.find((turn) => turn.toolCalls?.length)
  const results = outcome.history.find((turn) => turn.toolResults?.length)
  assert.equal(assistant?.toolCalls?.length, 2)
  assert.equal(results?.toolResults?.length, 2)
  assert.equal(events.filter((e) => e.type === EventType.TOOL_CALL_RESULT).length, 2)
})

test('a mutating call keeps its place in the order the model asked for', async () => {
  const log: string[] = []
  await runKernelPass({
    runId: 'k2',
    threadId: 't1',
    model: scripted([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_file', input: JSON.stringify({ path: 'x' }) },
        { type: 'tool-call', toolCallId: 'b', toolName: 'write_file', input: JSON.stringify({ path: 'x' }) },
        { type: 'tool-call', toolCallId: 'c', toolName: 'read_file', input: JSON.stringify({ path: 'x' }) },
        { type: 'finish', finishReason: toolCalls, usage },
      ],
      say('done'),
    ]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools: toolsFor(log),
    turns: [{ role: 'user', content: 'do it' }],
    maxSteps: 8,
    emit: () => {},
    errorRetryable: () => false,
  })
  /* the write is never hoisted above or below the reads around it */
  assert.deepEqual(log, ['read_file:x', 'write_file:x', 'read_file:x'])
})

test('the step ceiling is a pause with the transcript intact, not a failure', async () => {
  const log: string[] = []
  const outcome = await runKernelPass({
    runId: 'k3',
    threadId: 't1',
    model: scripted([[call('a', 'read_file', { path: 'one' })][0]]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools: toolsFor(log),
    turns: [{ role: 'user', content: 'read forever' }],
    maxSteps: 1,
    emit: () => {},
    errorRetryable: () => false,
  })

  assert.equal(outcome.stepLimit, true, 'the ceiling must be reported as a pause')
  assert.equal(outcome.error, null, 'a ceiling is not an error')
  assert.equal(outcome.history.some((turn) => turn.toolResults?.length), true, 'the work was lost')
})

test('a picture comes back as a file part, not as base64 prose', async () => {
  const tools = {
    read_image: tool({
      description: 'read an image',
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ shotBase64: 'iVBORw0KGgo=', shot: 'shot.png' }),
    }),
  } as never
  const outcome = await runKernelPass({
    runId: 'k4',
    threadId: 't1',
    model: scripted([[call('a', 'read_image', { path: 'shot.png' })][0], say('I see it')]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools,
    turns: [{ role: 'user', content: 'look' }],
    maxSteps: 8,
    emit: () => {},
    errorRetryable: () => false,
  })
  const result = outcome.history.find((turn) => turn.toolResults?.length)?.toolResults?.[0]
  assert.equal(result?.image, 'iVBORw0KGgo=')
  assert.ok(result?.output.includes('image'), 'the transcript keeps a receipt, not the payload')
})

/* ---------------------------------------------------------------------------
   Deliveries: the count a claim is checked against.
   --------------------------------------------------------------------------- */

test('an outward command is recognised, a local one is not', () => {
  assert.equal(isOutward('curl -X POST https://example.test/submit -d "{}"'), true)
  assert.equal(isOutward('Invoke-RestMethod -Uri https://example.test -Method Post'), true)
  assert.equal(isOutward('npm test'), false)
  assert.equal(isOutward('dir'), false)
})

test('the key a command carried is stable', () => {
  assert.equal(
    deliveryKey('curl -X POST https://api.test/submit -d "{\\"key\\":\\"letter-count-1\\"}"'),
    'letter-count-1',
  )
  assert.equal(deliveryKey('node submit.js math-sum-1'), 'math-sum-1')
  assert.equal(deliveryKey('curl https://example.test/a/b'), 'b')
})

test('a claim of nine is read as nine — and a test count is not a claim', () => {
  assert.equal(claimedDeliveries('Section 1 complete — 9/9 submitted.'), 9)
  assert.equal(claimedDeliveries('All 19 images answered.'), 19)
  assert.equal(claimedDeliveries('تم تسليم 9/9'), 9)
  assert.equal(claimedDeliveries('All 12 tests passed.'), null)
  assert.equal(claimedDeliveries('12 files changed.'), null)
  assert.equal(claimedDeliveries('The build is slow.'), null)
})

/* ---------------------------------------------------------------------------
   A 429 that never says 429.

   OpenRouter answers a saturated free model with `message: "Provider returned
   error"`, the status on the error object and the reason inside responseBody.
   Classification reads the string, so the run used to treat a rate limit as a
   fatal provider fault and print four words that explain nothing.
   --------------------------------------------------------------------------- */

test('a provider 429 keeps its status and its reason in the error text', async () => {
  const model = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'busy',
    doStream: async () => {
      throw Object.assign(new Error('Provider returned error'), {
        statusCode: 429,
        responseBody: JSON.stringify({
          error: {
            message: 'Provider returned error',
            code: 429,
            metadata: { raw: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream.' },
          },
        }),
      })
    },
  })
  const outcome = await runKernelPass({
    runId: 'k5',
    threadId: 't1',
    model,
    config: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
    system: () => 'system',
    tools: toolsFor([]),
    turns: [{ role: 'user', content: 'hi' }],
    maxSteps: 4,
    emit: () => {},
    errorRetryable: () => true,
  })
  assert.match(outcome.error ?? '', /HTTP 429/, 'the status is what makes it retryable')
  assert.match(outcome.error ?? '', /rate-limited upstream/, 'the reason is what the reader needs')
})

test('a full free pool is explained in the reader\'s words, not the provider\'s', async () => {
  const { friendlyError, isRetryable } = await import('../server/agent.ts')
  const raw =
    'Provider returned error (HTTP 429): google/gemma-4-31b-it:free is temporarily rate-limited upstream.'
  assert.equal(isRetryable(raw), true)
  const text = friendlyError(raw)
  assert.match(text, /not by your key/i)
  assert.ok(!text.includes('Provider returned error'))
})

/* ---------------------------------------------------------------------------
   Arguments the model made up, and pictures that never leave the transcript.
   --------------------------------------------------------------------------- */

test('a tool is not run with arguments that do not match its schema', async () => {
  let ran = 0
  const tools = {
    update_plan: tool({
      description: 'plan',
      inputSchema: z.object({
        task: z.string(),
        /* the real shape: a list. A string here used to reach the tool and
           throw "done_when.map is not a function" inside it. */
        done_when: z.array(z.string()).optional(),
        steps: z.array(z.object({ description: z.string(), status: z.string() })).min(1),
      }),
      execute: async () => {
        ran += 1
        return 'planned'
      },
    }),
  } as never

  const outcome = await runKernelPass({
    runId: 'k6',
    threadId: 't1',
    model: scripted([
      [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'a',
          toolName: 'update_plan',
          input: JSON.stringify({ task: 'x', done_when: 'all tests pass', steps: [] }),
        },
        { type: 'finish', finishReason: toolCalls, usage },
      ],
      say('ok'),
    ]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools,
    turns: [{ role: 'user', content: 'plan it' }],
    maxSteps: 6,
    emit: () => {},
    errorRetryable: () => false,
  })

  assert.equal(ran, 0, 'the tool ran with invalid arguments')
  const result = outcome.history.find((turn) => turn.toolResults?.length)?.toolResults?.[0]
  assert.equal(result?.ok, false)
  assert.match(result?.output ?? '', /Invalid arguments/)
})

test('a picture is attached for a couple of steps, then becomes a receipt', async () => {
  const tools = {
    read_image: tool({
      description: 'read an image',
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ shotBase64: 'iVBORw0KGgo=', shot: 'shot.png' }),
    }),
    noop: tool({
      description: 'a step that keeps the loop going',
      inputSchema: z.object({ n: z.string() }),
      execute: async () => 'ok',
    }),
  } as never

  const outcome = await runKernelPass({
    runId: 'k7',
    threadId: 't1',
    model: scripted([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'a', toolName: 'read_image', input: JSON.stringify({ path: 'shot.png' }) },
        { type: 'finish', finishReason: toolCalls, usage },
      ],
      call('b', 'noop', { n: '1' }),
      call('c', 'noop', { n: '2' }),
      say('done'),
    ]),
    config: { provider: 'ollama', model: 'mock' },
    system: () => 'system',
    tools,
    turns: [{ role: 'user', content: 'look' }],
    maxSteps: 8,
    emit: () => {},
    errorRetryable: () => false,
  })

  const result = outcome.history.find((turn) => turn.toolResults?.length)?.toolResults?.[0]
  assert.equal(result?.image, undefined, 'the base64 stayed in the transcript')
  assert.match(result?.output ?? '', /no longer attached/)
})
