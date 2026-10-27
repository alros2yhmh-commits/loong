import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'

/* ---------------------------------------------------------------------------
   The gaps that blocked the interface, tested.

   G1 — settings had no home. They lived in the browser's localStorage, which
   was deleted with the interface, so every preference died on reload.
   G3 — nothing published what tools the agent has, so the UI would hardcode a
   list that drifts.
   G5 — a restored session showed nothing until the next run started.

   These tests start the real server and drive it over HTTP, because the
   contract that matters is the one the interface will consume.

   The server is asked for port 0 and the port it actually bound is read back
   from its own banner: a fixed port turns "the previous run has not died yet"
   into a test failure, and a fixed data directory does the same across files.
   --------------------------------------------------------------------------- */

const dataDir = mkdtempSync(join(tmpdir(), 'loong-settings-'))

let base = ''
let proc: ChildProcess | null = null
let boot = ''

/** wait for the server's own announcement, or for it to die trying */
function start(): Promise<void> {
  if (base) return Promise.resolve()
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LOONG_PORT: '0',
        LOONG_DATA_DIR: dataDir,
        NO_PROXY: '127.0.0.1,localhost',
      },
    })

    const timer = setTimeout(() => {
      reject(new Error(`the server did not announce a port in 30s. its output was:\n${boot}`))
    }, 30_000)

    const onData = (chunk: Buffer) => {
      boot += chunk.toString()
      const m = /agent server\s+http:\/\/[^:]+:(\d+)/.exec(boot)
      if (!m) return
      clearTimeout(timer)
      base = `http://127.0.0.1:${m[1]}`
      resolve()
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', (c: Buffer) => {
      boot += c.toString()
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (!base) {
        reject(new Error(`the server exited (code ${code}) before it was ready:\n${boot}`))
      }
    })
  })
}

const get = async (path: string) => {
  await start()
  const r = await fetch(base + path)
  return { status: r.status, body: await r.json().catch(() => null) }
}
const send = async (method: string, path: string, body?: unknown) => {
  await start()
  const r = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const put = (path: string, body: unknown) => send('PUT', path, body)
const post = (path: string, body: unknown = {}) => send('POST', path, body)

test('G1: settings persist and survive a restart', async () => {
  const first = await get('/api/settings')
  assert.equal(first.status, 200)
  assert.ok(first.body.settings, 'the settings object is present')
  assert.equal(typeof first.body.settings.fontSize, 'number')
  assert.equal(first.body.settings.route, 'manual', 'a new installation pins its model by default')

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
  const bad = await put('/api/settings', {
    settings: { fontSize: 999, view: 'nonsense', volume: 12 },
  })
  assert.equal(bad.body.settings.fontSize, 24, 'fontSize clamps to the 24px ceiling')
  assert.equal(bad.body.settings.view, 'normal', 'an unknown view falls back')
  assert.equal(bad.body.settings.volume, 1, 'volume clamps to 1')

  /* the file is on disk — this is the whole difference from localStorage */
  const raw = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(raw.settings.fontSize, 24)
})

test('G1: a partial update merges instead of replacing', async () => {
  await put('/api/settings', { settings: { model: 'keep-me', userName: 'Prof' } })
  const after = await put('/api/settings', { settings: { fontSize: 15 } })
  assert.equal(after.body.settings.model, 'keep-me', 'an unrelated field survives')
  assert.equal(after.body.settings.userName, 'Prof')
  assert.equal(after.body.settings.fontSize, 15)
})

test('model routing is explicit and Plan is not persisted as a restart default', async () => {
  const selected = await put('/api/settings', {
    settings: { provider: 'openrouter', model: 'example/model:free', route: 'auto', mode: 'plan' },
  })
  assert.equal(selected.body.settings.route, 'auto')
  assert.equal(selected.body.settings.mode, 'plan', 'the current interaction may still plan')
  const raw = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(raw.settings.mode, 'agent', 'Plan should not turn every future launch read-only')
  assert.equal(raw.settings.route, 'auto', 'an explicit routing preference survives')
  const invalid = await put('/api/settings', { settings: { provider: 'unsupported', route: 'surprise' } })
  assert.equal(invalid.body.settings.provider, 'ollama')
  assert.equal(invalid.body.settings.route, 'manual')
})

test('settings survive an actual process restart without treating valid numeric preferences as corrupt', async () => {
  await put('/api/settings', { settings: {
    provider: 'openrouter', model: 'example/free-a:free', route: 'manual',
    mode: 'plan', volume: 0.25, fontSize: 19, userName: 'مطور',
  } })
  if (proc) {
    const child = proc
    await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill() })
  }
  proc = null
  base = ''
  boot = ''
  const restarted = await get('/api/settings')
  assert.equal(restarted.body.settings.model, 'example/free-a:free')
  assert.equal(restarted.body.settings.provider, 'openrouter')
  assert.equal(restarted.body.settings.route, 'manual')
  assert.equal(restarted.body.settings.mode, 'agent', 'Plan does not persist across launches')
  assert.equal(restarted.body.settings.volume, 0.25)
  assert.equal(restarted.body.settings.fontSize, 19)
  assert.equal(restarted.body.settings.userName, 'مطور')
  assert.equal(readdirSync(dataDir).some((name) => name.includes('settings.json.corrupt')), false)
})

test('G3: the tool manifest is published', async () => {
  const r = await get('/api/tools')
  assert.equal(r.status, 200)
  const names = r.body.tools.map((x: { name: string }) => x.name)
  for (const must of ['list_dir', 'read_file', 'grep', 'write_file', 'shell', 'ask_user', 'plan']) {
    assert.ok(names.includes(must), `${must} is published`)
  }
  /* every entry declares its access level, so the UI can show what asks first */
  for (const tool of r.body.tools) {
    assert.ok(
      ['read', 'write', 'ask', 'plan'].includes(tool.access),
      `${tool.name} has an access level`,
    )
  }
})

test('G5: a restored session reports its state', async () => {
  const created = await post('/api/sessions', {})
  assert.equal(created.status, 201)
  const id = created.body.session.id
  const state = await get(`/api/sessions/${id}/state`)
  assert.equal(state.status, 200)
  assert.equal(state.body.id, id)
  assert.equal(state.body.blocks, 0)
  assert.equal(state.body.running, false, 'a fresh session is not running')
  assert.equal(state.body.plan, null, 'a fresh session has no plan')
  await send('DELETE', `/api/sessions/${id}`)
})

test.after(() => {
  proc?.kill()
  proc = null
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* a scratch dir is not worth failing over */
  }
})
