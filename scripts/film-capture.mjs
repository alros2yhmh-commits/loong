/* ---------------------------------------------------------------------------
   Capture the real run for the Loong launch film.

   Drives the packaged app through a real OpenRouter run (deepseek-v4.1-flash)
   on a clean English workspace, and photographs the interface at every beat:
   the prompt, the plan, the tools, the writes, the audit, the summary. The
   run's own trace closes the loop and gives the film its real numbers.

   Two phases, because of the key handshake: the agent reads its keys once at
   spawn, so a key set mid-session only reaches a restarted app. If a key for
   the provider already exists, this is a single launch.

   Everything lands in ../film/: frames (deduped), trace.json, meta.json.
   --------------------------------------------------------------------------- */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'

const EXE = 'app/win-unpacked/Loong.exe'
const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5274'
const OUT = '../film'
const FRAMES = `${OUT}/frames`
const SETTINGS_KEY = 'loong.settings.v1'
const DEMO_DIR = 'C:/Users/Hamza/Desktop/loong-demo'
const PROVIDER = 'openrouter'
/* the account holds zero credits — deepseek is paid and refused mid-run with
   "account is out of credit". A free tool-capable model on the SAME api keeps
   the film real (api, not local) and costs nothing; north-mini-code is the
   code-specialised one, and the app's own fallback chain (laguna, gpt-oss,
   nemotron) catches a rate-limited free model automatically. */
const MODEL = 'cohere/north-mini-code:free'
const KEY = process.env.LOONG_FILM_KEY

if (!KEY) {
  console.error('set LOONG_FILM_KEY first')
  process.exit(1)
}

mkdirSync(DEMO_DIR, { recursive: true })
mkdirSync(FRAMES, { recursive: true })

/* the app reopens the workspace it persisted in userData/workspace.txt — which
   still points at the old E2E folder. Point it at the film's clean workspace
   before launch, or the run writes into the wrong place (learned the hard way:
   the plan ran, the write went nowhere). */
const WORKSPACE_FILE = 'C:/Users/Hamza/AppData/Roaming/Loong/workspace.txt'
try {
  writeFileSync(WORKSPACE_FILE, DEMO_DIR, 'utf8')
  console.log(`  workspace.txt -> ${DEMO_DIR}`)
} catch (e) {
  console.log(`  could not set workspace.txt: ${e.message}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`  ${m}`)

/* the film's task: English, tightly scoped — a single file, a plan, an audit.
   It exercises exactly what the film shows: plan → tools → write → verify. */
const PROMPT = [
  'Build a landing page for Loong, a desktop coding agent.',
  '',
  '1) Call update_plan first with a 3-step plan and done_when criteria.',
  '2) Create one file, index.html, with inline CSS only — no frameworks, no',
  'external assets, no images. Monochrome black and white, clean, generous',
  'spacing, Inter font. Sections: a hero with "Loong (龙)" and the tagline',
  '"The desktop coding agent that tells you the truth"; a row of three',
  'features (Honest runs, Dialable trust, Watchable and rewindable); and a',
  'footer linking to github.com/hbyalros2y-dev/loong. Keep the file under 15KB.',
  '3) Finish by calling audit with one item per done_when criterion and the',
  'evidence that proves it.',
  '',
  'Create no other files. Never invent tool results.',
].join('\n')

async function waitFor(fn, { timeout = 60_000, interval = 700, what = 'it' }) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() > deadline) return null
    await sleep(interval)
  }
}

function killApp() {
  try {
    execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  } catch {}
}

const launchEnv = {
  ...process.env,
  NO_PROXY: '127.0.0.1,localhost',
  LOONG_WORKSPACE: DEMO_DIR,
}
delete launchEnv.ELECTRON_RUN_AS_NODE

function launch() {
  log(`launching (workspace: ${DEMO_DIR})`)
  spawn(EXE, ['--remote-debugging-port=9222'], { env: launchEnv, stdio: 'ignore' })
}

async function connectPage() {
  const browser = await waitFor(
    async () => (await chromium.connectOverCDP(CDP).catch(() => null)) ?? false,
    { what: 'the CDP endpoint', timeout: 30_000 },
  )
  if (!browser) throw new Error('no CDP endpoint')
  const page = await waitFor(
    async () => {
      for (const p of browser.contexts()[0].pages()) {
        if (p.url().includes('index.html')) return p
      }
      return null
    },
    { what: 'the app window', timeout: 30_000 },
  )
  if (!page) throw new Error('no app window')
  await waitFor(() => page.evaluate(() => Boolean(window.loong?.token)), {
    what: 'the preload bridge',
  })
  return { browser, page }
}

/* ---- phase 1: does the provider already have a key? ---------------------- */

killApp()
await sleep(1500)
launch()
const { browser, page } = await connectPage()

const hasKey = await page.evaluate(async (p) => {
  try {
    return await window.loong.hasKey(p)
  } catch {
    return false
  }
}, PROVIDER)

/* the packaged agent reads its keys ONCE, at spawn — so a key that is already
   stored but stale (the app's old one, failing with "User not found." — an
   OpenRouter 401) must be overwritten AND the app relaunched. No shortcuts:
   set the key, then restart, every time. */
log(hasKey ? 'a stale key is stored — replacing it' : 'no stored key — setting it')
const ok = await page.evaluate(
  async ([p, k]) => {
    try {
      const r = await window.loong.setKey(p, k)
      return r?.ok === true
    } catch {
      return false
    }
  },
  [PROVIDER, KEY],
)
if (!ok) {
  console.error('could not store the key')
  process.exit(1)
}
log('key stored — relaunching so the agent handshake carries it')

/* point the interface at the film's provider + model + full trust */
const settingsNow = await page.evaluate(([k, provider, model]) => {
  const s = JSON.parse(window.localStorage.getItem(k) ?? '{}')
  s.provider = provider
  s.model = model
  s.route = 'manual'
  s.trust = 'auto'
  window.localStorage.setItem(k, JSON.stringify(s))
  return JSON.stringify(s)
}, [SETTINGS_KEY, PROVIDER, MODEL])
log(`settings set: ${settingsNow}`)

/* the app read its settings at boot — reload so the new ones take effect */
await page.reload()
await waitFor(() => page.evaluate(() => Boolean(window.loong?.token)), {
  what: 'the preload bridge after reload',
})
const applied = await page.evaluate((k) => {
  const s = JSON.parse(window.localStorage.getItem(k) ?? '{}')
  return `${s.provider}/${s.model} trust=${s.trust}`
}, SETTINGS_KEY)
log(`app now on: ${applied}`)

/* the key handshake happens at spawn — a second launch carries it */
browser.close().catch(() => {})
killApp()
await sleep(2000)
const restarted = true
launch()
const live = await connectPage()

/* ---- phase 2: the run ---------------------------------------------------- */

const { page: run } = live
await sleep(800)

/* the welcome screen, if this is genuinely the first launch ever */
const addKey = run.getByRole('button', { name: /Add an API key/i })
if (await addKey.isVisible().catch(() => false)) {
  await addKey.click()
  await sleep(600)
}

const token = await run.evaluate(() => window.loong.token())
const api = async (path) => {
  const res = await fetch(BASE + path, { headers: { 'x-loong-token': token } })
  return res.json()
}

const before = await api('/api/traces')
const beforeIds = new Set((before.traces ?? []).map((t) => t.runId))
log(`traces before the run: ${beforeIds.size}`)

await run.keyboard.press('Control+n')
await sleep(900)

/* one message, one send — fill() never breaks the prompt into turns */
await run.locator('textarea').fill(PROMPT)
await sleep(500)
await run.screenshot({ path: `${FRAMES}/00-prompt.png` })
log('📸 00-prompt.png — the English task, ready')

await run.keyboard.press('Enter')
const sentAt = Date.now()
log('run sent — capturing beats')

/* capture: every 2s, but only when the picture actually changed */
let lastHash = ''
let n = 0
const captures = []
const captureLoop = setInterval(async () => {
  try {
    const buf = await run.screenshot({ type: 'jpeg', quality: 88 })
    const hash = createHash('md5').update(buf).digest('hex')
    if (hash === lastHash) return
    lastHash = hash
    n += 1
    const name = `beat-${String(n).padStart(3, '0')}`
    writeFileSync(`${FRAMES}/${name}.jpg`, buf)
    captures.push({ name, at: Date.now() - sentAt })
  } catch {}
}, 2000)

const trace = await waitFor(
  async () => {
    const data = await api('/api/traces')
    const fresh = (data.traces ?? []).find((t) => !beforeIds.has(t.runId) && t.endedAt)
    return fresh ?? null
  },
  { what: 'the run to end', timeout: 40 * 60_000, interval: 8_000 },
)

await sleep(2500) /* let the summary settle */
clearInterval(captureLoop)
const finalBuf = await run.screenshot({ path: `${FRAMES}/99-final.png` })
captures.push({ name: '99-final', at: Date.now() - sentAt })
log(`📸 99-final.png — run over, ${captures.length} beats captured`)

/* the real numbers the film will show */
const meta = {
  model: MODEL,
  provider: PROVIDER,
  prompt: PROMPT,
  frames: captures,
  runMs: Date.now() - sentAt,
  restarted,
  trace: trace ? {
    runId: trace.runId,
    endedAt: trace.endedAt,
    startedAt: trace.startedAt,
    toolSpans: trace.spans ?? [],
    tokens: trace.usage ?? null,
  } : null,
}
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 2))

/* the artifact the run built, photographed */
const built = `${DEMO_DIR}/index.html`
if (existsSync(built)) {
  writeFileSync(`${OUT}/built-index.html`, readFileSync(built, 'utf8'))
  log(`artifact captured: ${readFileSync(built, 'utf8').length} bytes of index.html`)
} else {
  log('WARNING: no index.html in the demo workspace')
}

/* the thread itself, as the film sees it */
await run.screenshot({ path: `${FRAMES}/98-thread.png` })

killApp()
log(`done — frames in ${FRAMES}/, meta in ${OUT}/meta.json`)
console.log(JSON.stringify({ ok: true, beats: captures.length, trace: Boolean(trace) }))
