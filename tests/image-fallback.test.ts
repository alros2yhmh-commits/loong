import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { runAgent } from '../server/agent.ts'

/* ---------------------------------------------------------------------------
   A text-only model, sent an image.

   The provider answers "No endpoints found that support image input". That is
   not a provider fault and retrying the same payload three times only prints
   the same sentence three times. The run must drop the images, say so once, and
   continue with the text.
   --------------------------------------------------------------------------- */

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const stop = { unified: 'stop' as const, raw: 'stop' }

const textChunks = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'read the text' },
  { type: 'text-end', id: 't1' },
  { type: 'finish', finishReason: stop, usage },
]

test('an image rejection is retried once without the image, and explained once', async () => {
  let calls = 0
  const model = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'text-only',
    doStream: async () => {
      calls += 1
      if (calls === 1) throw new Error('No endpoints found that support image input')
      return {
        stream: simulateReadableStream({
          chunks: textChunks as never[],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      } as never
    },
  })

  const events: BaseEvent[] = []
  await runAgent({
    runId: 'img-run',
    threadId: 'img-thread',
    messages: [{ role: 'user', content: 'look at this' }],
    history: [
      { role: 'user', content: 'look at this', images: ['data:image/png;base64,AAAA'] },
    ],
    config: { provider: 'openrouter', model: 'text-only' },
    mode: 'agent',
    trust: 'auto',
    model,
    emit: (e) => events.push(e),
  })

  assert.equal(calls, 2, 'one corrected retry, not a loop')

  /* the notices ABOUT THE IMAGE — a run may also say which skill it picked up,
     and that is a different sentence, not a repeat of this one */
  const notices = events.filter(
    (e) =>
      e.type === EventType.CUSTOM &&
      (e as unknown as { name?: string }).name === 'loong.notice' &&
      /image/i.test(JSON.stringify((e as unknown as { value?: unknown }).value ?? '')),
  )
  assert.equal(notices.length, 1, 'the reader is told once, not three times')
  assert.match(
    JSON.stringify(notices[0]),
    /cannot read images/i,
  )

  assert.ok(
    events.some((e) => e.type === EventType.RUN_FINISHED),
    'the run finishes on the text alone',
  )
})
