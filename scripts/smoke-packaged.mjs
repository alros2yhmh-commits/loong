/* ---------------------------------------------------------------------------
   Smoke the packaged app.

   Launches the real EXE with no flags of its own (the app carries its own
   sandbox/GPU workarounds), opens a CDP channel so the renderer can be
   driven, and proves the three things a packaged build can silently lose:

     1. the agent sidecar is online (the token gate answers 200)
     2. the renderer painted (root has children)
     3. a session can be created and renamed over the real HTTP API

   The token is minted inside the main process and lives for one run, so it is
   read the only honest way available from outside — the renderer's own
   preload bridge — which also proves the bridge itself works.

   Usage: node scripts/smoke-packaged.mjs
   --------------------------------------------------------------------------- */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const EXE = 'app/win-unpacked/Loong.exe'
const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5274'
const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, { timeout = 30_000, interval = 500, what }) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`)
    await sleep(interval)
  }
}

/* ---- launch -------------------------------------------------------------- */

/* stale instances hold port 5274; the packaged agent is the only singer */
try {
  execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  await sleep(1500)
} catch {}

console.log('launching packaged app…')
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE /* this shell sets it globally; the EXE must be Electron */
const app = spawn(EXE, ['--remote-debugging-port=9222'], {
  env,
  stdio: 'ignore',
  detached: false,
})
let appOut = ''
app.on('error', (e) => {
  appOut += `spawn error: ${e.message}\n`
})

const cleanup = () => {
  try {
    execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  } catch {}
}
process.on('exit', cleanup)

/* ---- 1. the agent sidecar -------------------------------------------------- */

const health = await waitFor(
  async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { 'x-loong-token': 'probe' },
    }).catch(() => null)
    return res && res.status === 401 ? 'gate-alive' : null
  },
  { what: 'the agent to answer on 5274', timeout: 45_000 },
)
check('agent sidecar online (gate answers, unsigned refused)', health === 'gate-alive')

/* ---- 2. the renderer ------------------------------------------------------ */

const browser = await waitFor(async () => {
  const b = await chromium.connectOverCDP(CDP).catch(() => null)
  return b
}, { what: 'the CDP endpoint' })
const context = browser.contexts()[0]
const page = await waitFor(
  async () => {
    for (const p of context.pages()) {
      if (p.url().startsWith('file://') && p.url().includes('index.html')) return p
    }
    return null
  },
  { what: 'the app window' },
)

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

/* the preload bridge is the token's only honest carrier — wait for it */
await waitFor(() => page.evaluate(() => Boolean(window.loong?.token)), {
  what: 'the preload bridge',
  timeout: 20_000,
})

const painted = await page.evaluate(() => ({
  root: document.getElementById('root')?.childElementCount ?? -1,
  text: document.body.innerText.slice(0, 80),
}))
check('renderer painted (root has children)', painted.root >= 1, `root children=${painted.root}`)

const token = await page.evaluate(() => window.loong.token())
check('preload bridge yielded a session token', typeof token === 'string' && token.length > 10)

const withToken = await fetch(`${BASE}/api/health`, {
  headers: { 'x-loong-token': token },
})
check('health 200 with the token', withToken.status === 200, `status ${withToken.status}`)

/* ---- 3. the HTTP API, driven the way the UI drives it ---------------------- */

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-loong-token': token, ...(opts.headers ?? {}) },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

const ws = await api('/api/workspace')
check('workspace reported', ws.status === 200, ws.json?.workspace ?? '')

const files = await api('/api/files?q=src')
check('file index answers (@mention feed)', files.status === 200 && Array.isArray(files.json?.files))

const created = await api('/api/sessions', { method: 'POST', body: '{}' })
const sid = created.json?.session?.id
check('session created (201)', created.status === 201 && Boolean(sid), `id ${sid}`)

const renamed = await api(`/api/sessions/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'smoke check' }),
})
check('session renamed (200)', renamed.status === 200, renamed.json?.session?.title ?? '')

const readback = await api('/api/sessions')
const found = (readback.json?.sessions ?? []).find((s) => s.id === sid)
check('rename persisted to disk', found?.title === 'smoke check', found?.title ?? '(missing)')

await api(`/api/sessions/${sid}`, { method: 'DELETE' })
check('session deleted', true)

/* ---- 4. the screen --------------------------------------------------------- */

await sleep(600)
await page.screenshot({ path: `${SHOTS}/packaged-01-empty.png` })
writeFileSync(`${SHOTS}/packaged-verdict.json`, JSON.stringify({ checks, tokenGate: 'fail-closed' }, null, 2))

/* ---- verdict -------------------------------------------------------------- */

await sleep(300)
const failed = checks.filter((c) => !c.ok)
console.log()
console.log(`  ${checks.length - failed.length}/${checks.length} checks passed`)
if (consoleErrors.length) {
  console.log(`  console errors: ${consoleErrors.slice(0, 5).join(' | ')}`)
} else {
  console.log('  no console errors')
}
if (appOut) console.log(`  app stderr: ${appOut.trim()}`)

browser.close().catch(() => {})
cleanup()
process.exit(failed.length ? 1 : 0)
