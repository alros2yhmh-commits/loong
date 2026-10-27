import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tool } from 'ai'
import { z } from 'zod'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { runKernelPass } from '../server/engine/kernel.ts'

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const finish = (tools = false) => ({ type: 'finish', finishReason: { unified: tools ? 'tool-calls' : 'stop', raw: tools ? 'tool_calls' : 'stop' }, usage })
const say = [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Verified.' }, { type: 'text-end', id: 't' }, finish()]
const call = (name: string, input: unknown = {}, providerMetadata?: unknown) => [
  { type: 'tool-call', toolCallId: `call-${name}`, toolName: name, input: JSON.stringify(input), providerMetadata }, finish(true),
]
const read = tool({ description: 'Read a file.', inputSchema: z.object({}), execute: async () => 'contents' })

async function run(parts: unknown[][], tools: Record<string, unknown> = { read_file: read }, options: Record<string, unknown> = {}) {
  const requests: unknown[] = []
  let index = 0
  const model = new MockLanguageModelV4({ provider: 'mock', modelId: 'mock', doStream: async (request) => {
    requests.push(request)
    return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...parts[Math.min(index++, parts.length - 1)]] as never[], initialDelayInMs: null, chunkDelayInMs: null }) } as never
  } })
  const outcome = await runKernelPass({ runId: 'protocol', threadId: 'protocol', model,
    config: { provider: 'ollama', model: 'mock' }, system: () => 'Use the tools.', tools: tools as never,
    turns: [{ role: 'user', content: 'Inspect this file.' }], maxSteps: 8, emit: () => {}, errorRetryable: () => false, ...options })
  return { outcome, requests: requests as { prompt: unknown[]; maxOutputTokens?: number; tools?: { name: string }[] }[] }
}

test('provider reasoning and tool signatures survive the next actual model request', async () => {
  const first = [
    { type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: 'Read before changing.' },
    { type: 'reasoning-end', id: 'r', providerMetadata: { google: { thoughtSignature: 'reasoning-signature' } } },
    ...call('read_file', {}, { google: { thoughtSignature: 'tool-signature' } }),
  ]
  const { requests, outcome } = await run([first, say])
  assert.equal(outcome.ok, true)
  const next = JSON.stringify(requests[1].prompt)
  assert.match(next, /Read before changing/)
  assert.match(next, /reasoning-signature/)
  assert.match(next, /tool-signature/)
})

test('output budget and actual response model are passed through the kernel', async () => {
  const { requests, outcome } = await run([[{ type: 'response-metadata', id: 'response', modelId: 'actual-model', timestamp: new Date() }, ...say]], {}, { maxOutputTokens: 1024 })
  assert.equal(requests[0].maxOutputTokens, 1024)
  assert.equal(outcome.actualModel, 'actual-model')
})

test('model receives compacted read output while canonical checkpoint remains complete', async () => {
  const output = 'BEGIN\n' + 'x'.repeat(30_000) + '\nESSENTIAL ERROR AT END'
  const source = tool({ description: 'Read.', inputSchema: z.object({}), execute: async () => output })
  const { outcome, requests } = await run([call('read_file'), say], { read_file: source })
  assert.ok(JSON.stringify(requests[1].prompt).length < 8_000)
  assert.match(JSON.stringify(requests[1].prompt), /ESSENTIAL ERROR AT END/)
  assert.equal(outcome.history.find((turn) => turn.role === 'tool')?.toolResults?.[0].output, output)
})

test('returned command errors are failed results rather than successful tool receipts', async () => {
  const shell = tool({ description: 'Run.', inputSchema: z.object({}), execute: async () => 'Command failed (exit code: 1).\nAssertion failed' })
  const { outcome } = await run([call('shell'), say], { shell })
  assert.equal(outcome.history.find((turn) => turn.role === 'tool')?.toolResults?.[0].ok, false)
})

test('large catalogs discover and activate extra schemas without advertising all tools initially', async () => {
  const tools: Record<string, unknown> = { read_file: read }
  for (let i = 0; i < 35; i++) tools[`special_${i}`] = tool({ description: `Capability ${i}`, inputSchema: z.object({}), execute: async () => `result-${i}` })
  const { requests, outcome } = await run([call('discover_tools', { query: 'special_34' }), call('special_34'), say], tools)
  assert.ok((requests[0].tools?.length ?? 99) < 10)
  assert.equal(requests[0].tools?.some((entry) => entry.name === 'special_34'), false)
  assert.equal(requests[1].tools?.some((entry) => entry.name === 'special_34'), true)
  assert.match(JSON.stringify(outcome.history), /result-34/)
})
