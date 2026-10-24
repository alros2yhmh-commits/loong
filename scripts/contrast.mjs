import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Hamza/Desktop/LOONG/../LoongApp/Loong.exe'
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await new Promise((r) => setTimeout(r, 1500))
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn(EXE, ['--remote-debugging-port=9222'], { env, stdio: 'ignore', cwd: EXE.replace(/Loong.exe$/, '') })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page = null
for (let i = 0; i < 40 && !page; i++) {
  await sleep(600)
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null)
  if (!b) continue
  for (const c of b.contexts()) for (const p of c.pages()) if (p.url().includes('index.html')) page = p
  if (!page) await b.close().catch(() => {})
}
await sleep(2500)
await page.evaluate(() => {
  const raw = window.localStorage.getItem('loong.settings')
  const cfg = raw ? JSON.parse(raw) : {}
  cfg.onboarded = true
  window.localStorage.setItem('loong.settings', JSON.stringify(cfg))
})
await page.reload()
await sleep(3000)
const bad = await page.evaluate(() => {
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
  const out = []
  for (const el of document.querySelectorAll('*')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
    if (!txt || txt.length < 2) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const size = parseFloat(cs.fontSize)
    const large = size >= 18 || (size >= 14 && Number(cs.fontWeight) >= 600)
    const need = large ? 3 : 4.5
    const got = ratio(parse(cs.color), parse(bgOf(el)))
    if (got < need) out.push({ ratio: Math.round(got * 100) / 100, need, size, text: txt.slice(0, 42) })
  }
  return out.sort((a, b) => a.ratio - b.ratio)
})
console.log(JSON.stringify(bad.slice(0, 22), null, 1))
console.log('BELOW AA:', bad.length)
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
