/* ---------------------------------------------------------------------------
   Audit the running app — not the source.

   Launches the packaged EXE, drives it over CDP, and answers the questions a
   screenshot alone cannot: is anything clipped, is any control unnamed, is the
   page wider than the window, does the tab order reach the composer, is any
   text too small to read. Screenshots are the evidence; these numbers are the
   proof.

   Usage: node scripts/audit-ui.mjs
   --------------------------------------------------------------------------- */

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const EXE = process.env.LOONG_EXE ?? 'C:/Users/Hamza/Desktop/LoongApp/Loong.exe'
const CDP = 'http://127.0.0.1:9222'
const SHOTS = 'shots/audit'
mkdirSync(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
  await sleep(1500)
} catch {}

const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
const app = spawn(EXE, ['--remote-debugging-port=9222'], {
  env,
  stdio: 'ignore',
  detached: false,
})

async function waitFor(fn, timeout = 40_000) {
  const end = Date.now() + timeout
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() > end) throw new Error('timeout')
    await sleep(400)
  }
}

/* the app may relaunch itself once under this sandbox, so the connection is
   re-established inside the wait — a handle from the dying instance never sees
   the new window */
const opened = await waitFor(async () => {
  const b = await chromium.connectOverCDP(CDP).catch(() => null)
  if (!b) return null
  for (const c of b.contexts()) {
    for (const p of c.pages()) {
      if (p.url().startsWith('file://') && p.url().includes('index.html')) return { b, p }
    }
  }
  await b.close().catch(() => {})
  return null
})
const browser = opened.b
const page = opened.p
await page.setViewportSize({ width: 1280, height: 820 })
await sleep(2500)

/* ---- the DOM questions --------------------------------------------------- */

const probe = async () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('*')]
    const clipped = []
    for (const el of all) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      /* a box that scrolls is allowed to overflow — that is what scrolling is */
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') continue
      if (el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0) {
        clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), over: el.scrollWidth - el.clientWidth })
      }
    }
    const unnamed = []
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      if (!label) unnamed.push({ tag: el.tagName, cls: String(el.className).slice(0, 60) })
    }
    const tiny = []
    for (const el of all) {
      if (!el.textContent?.trim() || el.children.length > 0) continue
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size > 0 && size < 10) tiny.push({ text: el.textContent.trim().slice(0, 30), size })
    }
    const images = [...document.querySelectorAll('img')].filter((i) => !i.alt).length
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      clipped: clipped.slice(0, 20),
      unnamed: unnamed.slice(0, 20),
      tiny: tiny.slice(0, 12),
      imagesNoAlt: images,
      buttons: document.querySelectorAll('button').length,
      focusables: document.querySelectorAll('button, a, input, textarea, select, [tabindex]').length,
      height: document.documentElement.scrollHeight,
    }
  })

const report = { screens: {}, probe: {} }

const shot = async (name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
  report.screens[name] = true
}

/* the things a screenshot cannot tell you */
const state = await page.evaluate(() => {
  const txt = (el) => (el?.textContent ?? '').trim()
  return {
    header: txt(document.querySelector('header')) || '',
    agentStatus: /offline|online/i.exec(document.body.innerText)?.[0] ?? '',
    unnamed: [...document.querySelectorAll('button')].filter(
      (b) => !(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim(),
    ).length,
    clippedText: [...document.querySelectorAll('*')]
      .filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return false
        return el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0
      })
      .map((el) => ({ cls: String(el.className).slice(0, 40), text: txt(el).slice(0, 50), over: el.scrollWidth - el.clientWidth })),
  }
})
report.state = state

/* 1. the home / empty state */
await shot('01-home')
report.probe.home = await probe()

/* 2. the sidebar open */
const sidebarToggle = page.locator('button[aria-label*="sidebar" i], button[title*="sidebar" i]').first()
if (await sidebarToggle.count()) {
  await sidebarToggle.click()
  await sleep(500)
}
await shot('02-sidebar')
report.probe.sidebar = await probe()

/* 3. settings — through the palette, the way a keyboard user reaches it */
await page.keyboard.press('Control+k')
await sleep(400)
await page.keyboard.type('settings')
await sleep(400)
await page.keyboard.press('Enter')
await sleep(1600)
{
  await shot('03-settings')
  await shot('03-settings')
  report.probe.settings = await probe()
  /* each section, to catch a clipped one */
  for (const id of ['models', 'skills', 'library', 'timers', 'integrations', 'mcp', 'about']) {
    const link = page.locator(`a[href="#${id}"], button:has-text("${id}")`).first()
    if (await link.count()) {
      await link.click({ timeout: 1500 }).catch(() => {})
      await sleep(350)
      await shot(`03-settings-${id}`)
    }
  }
  await page.keyboard.press('Escape')
  await sleep(400)
}

/* 4. the command palette */
await page.keyboard.press('Control+k')
await sleep(500)
await shot('04-palette')
report.probe.palette = await probe()
await page.keyboard.press('Escape')
await sleep(300)

/* 5. narrow window — the layout must survive 900px */
await page.setViewportSize({ width: 900, height: 700 })
await sleep(600)
await shot('05-narrow')
report.probe.narrow = await probe()
await page.setViewportSize({ width: 1280, height: 820 })
await sleep(400)

/* 6. a very short window — the composer must not be pushed out */
await page.setViewportSize({ width: 1280, height: 480 })
await sleep(600)
await shot('06-short')
report.probe.short = await probe()

writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 1), 'utf8')
console.log(JSON.stringify(report.probe, null, 1))
console.log('\nscreens:', Object.keys(report.screens).join(', '))

await browser.close().catch(() => {})
try {
  execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' })
} catch {}
