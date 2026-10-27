import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../server/tools.ts'
import { setWorkspace } from '../server/config.ts'
import { mayFallBackFor } from '../server/agent.ts'

setWorkspace(process.cwd())

/* The tools that were missing, tested where they can be tested without a
   network: the refusals, the schemas and the routing rules. The live calls are
   in scripts/check-tools.mjs, because a suite that needs the internet is a
   suite that fails on a train. */

type Callable = { execute: (input: unknown, context: unknown) => Promise<unknown> }

const call = async (name: keyof typeof TOOLS, input: unknown): Promise<string> => {
  const tool = TOOLS[name] as unknown as Callable
  return String(await tool.execute(input, { toolCallId: 'test-call' }))
}

test('http_request exists and goes through the guarded door', async () => {
  assert.ok(TOOLS.http_request, 'the tool is not registered')
  const out = await call('http_request', { url: 'http://127.0.0.1:9/private' })
  assert.match(out, /Refused/, 'a loopback address must be refused, not fetched')
})

test('http_request refuses a metadata address too', async () => {
  const out = await call('http_request', { url: 'http://169.254.169.254/latest/meta-data/' })
  assert.match(out, /Refused/)
})

test('http_request refuses a url that is not a url', async () => {
  const out = await call('http_request', { url: 'not a url' })
  assert.match(out, /Refused|failed/i)
})

test('read_image takes a URL now, and still refuses a private one', async () => {
  const out = await call('read_image', { path: 'http://127.0.0.1/secret.png' })
  assert.match(out, /Refused/)
  /* a workspace path is still a workspace path */
  const missing = await call('read_image', { path: 'does-not-exist.png' })
  assert.match(missing, /Could not read image/)
})

test('a free router model may fall back; a hand-picked paid one may not', () => {
  assert.equal(mayFallBackFor('openrouter/free', 'openrouter'), true)
  assert.equal(mayFallBackFor('openrouter/auto', 'openrouter'), true)
  assert.equal(mayFallBackFor('google/gemma-4-31b-it:free', 'openrouter'), true)
  assert.equal(mayFallBackFor('anthropic/claude-sonnet-4.5', 'openrouter'), false)
  assert.equal(mayFallBackFor('gpt-5', 'openai'), false)
})
