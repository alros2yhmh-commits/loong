import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.LOONG_TOKEN = 'test-only-session-token'
const { app } = await import('../server/index.ts')

test('trusted desktop preflight works without a token, actual calls require it', async () => {
  const preflight = await app.request('/api/runs/start', { method: 'OPTIONS', headers: {
    origin: 'loong://app', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-loong-token',
  } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'loong://app')
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PUT/)
  assert.equal((await app.request('/api/providers', { headers: { origin: 'loong://app' } })).status, 401)
  assert.equal((await app.request('/api/providers', { headers: { origin: 'loong://app', 'x-loong-token': 'test-only-session-token' } })).status, 200)
})

test('opaque or arbitrary origins cannot use an authenticated desktop agent', async () => {
  for (const origin of ['null', 'https://untrusted.example', 'loong://evil']) {
    const response = await app.request('/api/providers', { headers: { origin, 'x-loong-token': 'test-only-session-token' } })
    assert.equal(response.status, 403)
  }
})
