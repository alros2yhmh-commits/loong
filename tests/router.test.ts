import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeepMessage, pickDeep, pickFast, pickModel, routableFrom } from '../src/lib/router.ts'

/* ---------------------------------------------------------------------------
   The router.

   One rule is not taste: the tool-calling floor. A model that cannot call
   tools must never be routed to, because the failure is silent — the agent
   answers in prose and nothing runs. Everything else here is preference on
   top of that floor.
   --------------------------------------------------------------------------- */

const local = [
  { name: 'qwen2.5-coder:7b', supportsTools: false, sizeBytes: 0, family: 'qwen2' },
  { name: 'qwen3:8b', supportsTools: true, sizeBytes: 0, family: 'qwen3' },
]
const remote = [
  { name: 'free-small', supportsTools: true, free: true, contextLength: 8_000 },
  { name: 'paid-huge', supportsTools: true, free: false, contextLength: 200_000 },
  { name: 'free-huge', supportsTools: true, free: true, contextLength: 128_000 },
  { name: 'paid-novision', supportsTools: true, free: false, contextLength: 32_000 },
]

test('the floor: a model that cannot call tools is never chosen, even alone', () => {
  const only = [{ name: 'weak', supportsTools: false }]
  assert.equal(pickFast(only, []), null)
  assert.equal(pickDeep(only, []), null)
  assert.equal(pickModel('auto', 'anything', only, []), null)
})

test('fast prefers a local model — no network, no queue, no bill', () => {
  assert.equal(pickFast(local, remote), 'qwen3:8b')
})

test('fast falls back to the free tier when there is no local model', () => {
  assert.equal(pickFast([], remote), 'free-small')
})

test('deep prefers paid and wide over free', () => {
  assert.equal(pickDeep(local, remote), 'paid-huge')
})

test('deep ranks by context when the free flag is equal', () => {
  const mixed = [
    { name: 'free-a', supportsTools: true, free: true, contextLength: 10 },
    { name: 'free-b', supportsTools: true, free: true, contextLength: 90 },
  ]
  assert.equal(pickDeep([], mixed), 'free-b')
})

test('auto sends long messages deep', () => {
  assert.equal(isDeepMessage('x'.repeat(700)), true)
})

test('auto sends refactors, architecture and "why" deep', () => {
  assert.equal(isDeepMessage('refactor the auth module'), true)
  assert.equal(isDeepMessage('why is the build slow'), true)
  assert.equal(isDeepMessage('review this migration plan'), true)
})

test('auto keeps quick asks fast', () => {
  assert.equal(isDeepMessage('rename the button'), false)
  assert.equal(isDeepMessage('what does this error mean'), false)
})

test('auto routes a quick ask to fast and a big one to deep', () => {
  assert.equal(pickModel('auto', 'rename the button', local, remote), 'qwen3:8b')
  assert.equal(pickModel('auto', 'refactor the whole auth layer', [], remote), 'paid-huge')
})

test('manual routes to nothing — the configured model stands', () => {
  assert.equal(pickModel('manual', 'refactor everything', local, remote), null)
})

test('remote models are tool-capable by construction: the list is already filtered', () => {
  /* routableFrom keeps the lists as they are, with the flags intact — the
     floor is applied by the pickers, so the raw lists stay inspectable */
  const r = routableFrom(local, [
    { id: 'm', name: 'm', contextLength: 1, promptPrice: '0', free: true, supportsTools: true },
  ])
  assert.equal(r.remote[0].supportsTools, true)
  assert.equal(r.local.length, 2)
  assert.equal(r.local[0].supportsTools, false)
  assert.equal(r.local[1].supportsTools, true)
})
