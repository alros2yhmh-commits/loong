/* ---------------------------------------------------------------------------
   Drive a real run through the packaged app, and photograph the result.

   The smoke script proves the app boots and the bridge works. This one proves
   the run path: a live model (local Ollama — no key, no credits) is pointed at
   a prompt that must call update_plan, two read tools, and audit. Each of
   those has a face in the interface — PlanBlock, the grouped tools, AuditCard,
   RunSummary — and a run is the only thing that draws them.

   Two lessons from the first attempt are baked in:
   - the thread's own text is not a completion signal (the goal, the plan and
     the model's thinking all contain the words being waited for). The run's
     trace — written once, when the run ends — is the only honest one.
   - the tool-group header is upper-case ("3 TOOLS"), so match case-blind.

   The reader's own settings are snapshotted and put back: the test borrows the
   provider, it does not keep it.
   --------------------------------------------------------------------------- */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const EXE = 'app/win-unpacked/Loong.exe'
const CDP = 'http://127.0.0.1:9222'
const BASE = 'http://127.0.0.1:5274'
const SHOTS = 'shots'
const SETTINGS_KEY = 'loong.settings.v1'
mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`  ${m}`)

const PROMPT =
  'Follow these steps in order, using tools. ' +
  '1) Call update_plan with a 2-step plan for "inspect this project", ' +
  'reference "the project folder itself", ' +
  'done_when ["one directory listed", "project.godot read"]. ' +
  '2) Call list_dir on "." then read_file on "project.godot". ' +
  '3) Call audit with verdict "met" and one item: criterion "project.godot was read", ' +
  'met true, evidence "config_version found in project.godot". ' +
  'Do not write any files. Never invent tool results.'

async function waitFor(fn, { timeout = 60_000, interval = 700, what }) {
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

/* ---- launch -------------------------------------------------------------- */

try {
  execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  await sleep(1500)
} catch {}

console.log('launching packaged app…')
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn(EXE, ['--remote-debugging-port=9222'], { env, stdio: 'ignore' })
process.on('exit', () => {
  try {
    execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  } catch {}
})

const browser = await waitFor(async () => {
  const b = await chromium.connectOverCDP(CDP).catch(() => null)
  return b
}, { what: 'the CDP endpoint', timeout: 30_000 })
if (!browser) throw new Error('no CDP endpoint — the app never opened a window')

const page = await waitFor(
  async () => {
    for (const p of browser.contexts()[0].pages()) {
      if (p.url().includes('index.html')) return p
    }
    return null
  },
  { what: 'the app window' },
)
if (!page) throw new Error('no app window')

await waitFor(() => page.evaluate(() => Boolean(window.loong?.token)), {
  what: 'the preload bridge',
})

const token = await page.evaluate(() => window.loong.token())
const api = async (path) => {
  const res = await fetch(BASE + path, { headers: { 'x-loong-token': token } })
  return res.json()
}

/* the reader's settings are borrowed, not taken */
const saved = await page.evaluate((k) => window.localStorage.getItem(k), SETTINGS_KEY)
log(`settings snapshotted: ${saved ? 'yes' : '(defaults)'}`)

/* the first screen answers the two cold-start questions once; the test answers
   them the way a reader would — local model, no key */
const localChoice = page.getByRole('button', { name: /Use a local model/i })
if (await localChoice.isVisible().catch(() => false)) {
  await localChoice.click()
  log('welcome answered: local model')
  await sleep(700)
}

/* the trace count is the run's door: a new, closed trace means the run ended */
const before = await api('/api/traces')
const beforeIds = new Set((before.traces ?? []).map((t) => t.runId))
log(`traces before the run: ${beforeIds.size}`)

/* ---- point the app at the local model ------------------------------------- */

await page.keyboard.press('Control+,')
await waitFor(() => page.evaluate(() => document.body.innerText.includes('Provider')), {
  what: 'settings',
})
await page.getByRole('button', { name: 'Ollama', exact: true }).click()
await sleep(900) /* the local model list is fetched from the machine */

const modelSelect = page.locator('select').first()
const options = await modelSelect.locator('option').allTextContents()
log(`ollama models offered: ${options.join(', ')}`)
await modelSelect.selectOption('qwen3:8b')
await sleep(300)

const providerNow = await page.evaluate((k) => {
  const s = JSON.parse(window.localStorage.getItem(k) ?? '{}')
  return `${s.provider}/${s.model}`
}, SETTINGS_KEY)
log(`provider now: ${providerNow}`)

await page.getByRole('button', { name: 'Close' }).click()
await sleep(400)

/* ---- a fresh thread, and the run ------------------------------------------ */

await page.keyboard.press('Control+n')
await sleep(900)

await page.locator('textarea').click()
await page.keyboard.type(PROMPT, { delay: 4 })
await sleep(400)
await page.screenshot({ path: `${SHOTS}/live-01-composed.png` })
await page.keyboard.press('Enter')
const sentAt = Date.now()
log('run sent — watching the trace for the end (a local 8b thinks for a while)')

const trace = await waitFor(
  async () => {
    const data = await api('/api/traces')
    const fresh = (data.traces ?? []).find((t) => !beforeIds.has(t.runId) && t.endedAt)
    return fresh ?? null
  },
  { what: 'the run to end (its trace to close)', timeout: 40 * 60_000, interval: 10_000 },
)

const shots = []
const shot = async (name, what) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
  log(`📸 ${name}.png — ${what}`)
  shots.push(name)
}

if (!trace) {
  log('✗ the run never closed a trace — the model is still working or the run died')
  await shot('live-99-timeout', 'state at timeout')
} else {
  const tools = (trace.tools ?? []).map((t) => t.tool ?? t.name ?? '?')
  log(`run closed: outcome=${trace.outcome} tools=${tools.join(', ')} steps=${trace.steps ?? '?'}`)

  /* the run's whole life is on screen now — plan, tools, audit, summary */
  await shot('live-06-run', `the finished run: ${tools.join(', ')}`)
}

/* ---- what the interface actually shows ------------------------------------- */

const thread = await page.evaluate(() => {
  /* the thread column, not the goal bar: the goal restates the prompt, and the
     prompt names every element being looked for */
  const col = document.querySelector('[style*="--thread-measure"]')
  return col ? col.innerText : document.body.innerText
})
const facts = {
  planBlock: /PLAN/i.test(thread) && /reference ·/.test(thread),
  criteriaListed: /one directory listed/.test(thread),
  toolsGrouped: /(\d+)\s+TOOLS/i.test(thread),
  auditCard: /\bAUDIT\b/.test(thread) && /met/i.test(thread),
  runSummary: /\brun\b/i.test(thread) && /tools/i.test(thread),
  noErrorText: !/error|failed/i.test(thread),
}
writeFileSync(
  `${SHOTS}/live-verdict.json`,
  JSON.stringify({ facts, trace: trace ?? null, shots }, null, 2),
)

/* ---- put the reader's settings back --------------------------------------- */

await page.evaluate(
  ([k, v]) => {
    if (v) window.localStorage.setItem(k, v)
    else window.localStorage.removeItem(k)
  },
  [SETTINGS_KEY, saved],
)
log('settings restored')

await sleep(300)
const failed = Object.entries(facts).filter(([, v]) => v === false)
console.log()
console.log(`  ${Object.keys(facts).length - failed.length}/${Object.keys(facts).length} UI facts observed`)
for (const [k, v] of Object.entries(facts)) console.log(`    ${v ? '✓' : '✗'} ${k}`)
console.log(`  shots: ${shots.join(', ')}`)

browser.close().catch(() => {})
process.exit(failed.length ? 1 : 0)
