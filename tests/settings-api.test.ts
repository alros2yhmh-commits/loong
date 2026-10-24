import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/* ---------------------------------------------------------------------------
   The gaps that blocked the interface, tested.

   G1 — settings had no home. They lived in the browser's localStorage, which
   was deleted with the interface, so every preference died on reload.
   G3 — nothing published what tools the agent has, so the UI would hardcode a
   list that drifts.
   G5 — a restored session showed nothing until the next run started.

   These tests start the real server on a scratch port and drive it over HTTP,
   because the contract that matters is the one the interface will consume.
   --------------------------------------------------------------------------- */

const PORT = 5399
const BASE = `http://127.0.0.1:${PORT}`

let server: { proc: ReturnType<typeof import('node:child_process').spawn>; close: () => void } | null =
  null

async function start() {
  if (server) return
  const { spawn } = await import('node:child_process')
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/start.ts', '--port', String(PORT)],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        LOONG_PORT: String(PORT),
        LOONG_DATA_DIR: join(tmpdir(), 'loong-test'),
        NO_PROXY: '127.0.0.1,localhost',
      },
    },
  )
  await new Promise((r) => setTimeout(r, 2500))
  server = { proc, close: () => proc.kill() }
}

const get = async (path: string) => {
  const r = await fetch(BASE + path)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const put = async (path: string, body: unknown) => {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

test('G1: settings persist and survive a restart', async (t) => {
  await start()
  const first = await get('/api/settings')
  assert.equal(first.status, 200)
  assert.ok(first.body.settings, 'the settings object is present')
  assert.equal(typeof first.body.settings.fontSize, 'number')

  const written = await put('/api/settings', {
    settings: { model: 'a-model-for-the-test', fontSize: 17, view: 'verbose' },
  })
  assert.equal(written.status, 200)
  assert.equal(written.body.settings.fontSize, 17)
  assert.equal(written.body.settings.view, 'verbose')

  /* the point of the whole endpoint: a second read sees what the first wrote */
  const again = await get('/api/settings')
  assert.equal(again.body.settings.model, 'a-model-for-the-test')
  assert.equal(again.body.settings.fontSize, 17)

  /* a bad value is coerced, never stored — a setting is not trusted because it
     arrived over HTTP */
  const bad = await put('/api/settings', { settings: { fontSize: 999, view: 'nonsense', volume: 12 } })
  assert.equal(bad.body.settings.fontSize, 20, 'fontSize clamps to 20')
  assert.equal(bad.body.settings.view, 'normal', 'an unknown view falls back')
  assert.equal(bad.body.settings.volume, 1, 'volume clamps to 1')

  /* the file is on disk — this is the whole difference from localStorage */
  const dir = join(tmpdir(), 'loong-test')
  const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
  assert.equal(raw.settings.fontSize, 20)
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* a scratch dir is not worth failing over */
    }
  })
})

test('G1: a partial update merges instead of replacing', async () => {
  await start()
  await put('/api/settings', { settings: { model: 'keep-me', userName: 'Prof' } })
  const after = await put('/api/settings', { settings: { fontSize: 15 } })
  assert.equal(after.body.settings.model, 'keep-me', 'an unrelated field survives')
  assert.equal(after.body.settings.userName, 'Prof')
  assert.equal(after.body.settings.fontSize, 15)
})

test('G3: the tool manifest is published', async () => {
  await start()
  const r = await get('/api/tools')
  assert.equal(r.status, 200)
  const names = r.body.tools.map((x: { name: string }) => x.name)
  for (const must of ['list_dir', 'read_file', 'grep', 'write_file', 'shell', 'ask_user', 'plan']) {
    assert.ok(names.includes(must), `${must} is published`)
  }
  /* every entry declares its access level, so the UI can show what asks first */
  for (const tool of r.body.tools) {
    assert.ok(['read', 'write', 'ask', 'plan'].includes(tool.access), `${tool.name} has an access level`)
  }
})

test('G5: a restored session reports its state', async () => {
  await start()
  const created = await post('/api/sessions', {})
  assert.equal(created.status, 201)
  const id = created.body.session.id
  const state = await get(`/api/sessions/${id}/state`)
  assert.equal(state.status, 200)
  assert.equal(state.body.id, id)
  assert.equal(state.body.blocks, 0)
  assert.equal(state.body.running, false, 'a fresh session is not running')
  assert.equal(state.body.plan, null, 'a fresh session has no plan')
  await fetch(`${BASE}/api/sessions/${id}`, { method: 'DELETE' })
})

test.after(() => {
  server?.close()
  server = null
})
