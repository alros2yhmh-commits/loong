import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { setGlobalDispatcher, Agent } from 'undici'

/* The sandbox exports HTTP_PROXY, which playwright honours — so a loopback
   connection to the app's own DevTools port goes through the proxy and comes
   back 502. An empty ProxyAgent sends it straight out. */
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

/* ---------------------------------------------------------------------------
   Drive the packaged app and measure it.

   This is the evidence path: the real EXE, launched over CDP, with the real
   agent behind it. A green build is not evidence; a screenshot is not evidence;
   a driven run is evidence.
   --------------------------------------------------------------------------- */

const EXE = process.env.LOONG_EXE ?? 'C:/Users/Hamza/Desktop/LOONG/app/win-unpacked/Loong.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await sleep(1500)

const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.NODE_OPTIONS
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RUN_AS_NODE
spawn(EXE, ['--remote-debugging-port=9222'], { env, stdio: 'ignore', cwd: EXE.replace(/Loong.exe$/, '') })

let page = null
for (let i = 0; i < 40 && !page; i++) {
  await sleep(600)
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null)
  if (!b) continue
  const urls = []
  for (const c of b.contexts()) for (const p of c.pages()) { urls.push(p.url()); if (p.url().includes('index.html')) page = p }
  if (!page) console.log('pages:', urls)
  if (!page) await b.close().catch(() => {})
}
if (!page) { console.log('NO PAGE'); process.exit(1) }
await sleep(3500)

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

/* ---- the probe: contrast, overflow, unnamed controls, tiny text ---------- */
const PROBE = () => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const parse = (s) => { const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [255, 255, 255] }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const bgOf = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor
      if (c && !c.includes('rgba(0, 0, 0, 0)') && !/, 0\)$/.test(c)) return c
      n = n.parentElement
    }
    return 'rgb(255,255,255)'
  }
  const contrast = []
  const tiny = []
  const unnamed = []
  for (const el of document.querySelectorAll('*')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    if (txt.length >= 2) {
      const size = parseFloat(cs.fontSize)
      if (size < 10) tiny.push({ size, text: txt.slice(0, 30) })
      const large = size >= 18 || (size >= 14 && Number(cs.fontWeight) >= 600)
      const got = ratio(parse(cs.color), parse(bgOf(el)))
      if (got < (large ? 3 : 4.5)) contrast.push({ ratio: Math.round(got * 100) / 100, text: txt.slice(0, 30) })
    }
    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
      if (!name) unnamed.push(el.tagName)
    }
  }
  return {
    contrast,
    tiny,
    unnamed,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
}

const surfaces = {}

/* home */
surfaces.home = await page.evaluate(PROBE)
await page.screenshot({ path: 'shots/audit/08-home.png' })

/* settings */
await page.locator('button[aria-label="Settings"]').first().click({ timeout: 3000 }).catch(() => {})
await sleep(1200)
surfaces.settings = await page.evaluate(PROBE)
await page.screenshot({ path: 'shots/audit/08-settings.png' })
await page.keyboard.press('Escape')
await sleep(400)

/* narrow and short */
await page.setViewportSize({ width: 900, height: 620 })
await sleep(700)
surfaces.narrow = await page.evaluate(PROBE)
await page.screenshot({ path: 'shots/audit/08-narrow.png' })
await page.setViewportSize({ width: 1280, height: 860 })
await sleep(500)

for (const [k, v] of Object.entries(surfaces)) {
  console.log(
    k.padEnd(9),
    'contrast:' + String(v.contrast.length).padEnd(3),
    'unnamed:' + String(v.unnamed.length).padEnd(3),
    'tiny:' + String(v.tiny.length).padEnd(3),
    'overflow:' + v.overflow,
  )
}
console.log('console errors:', errors.length, errors.slice(0, 3))

try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
