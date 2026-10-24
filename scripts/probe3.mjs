import { chromium } from 'playwright-core'
const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null)
if (!b) { console.log('no cdp'); process.exit(0) }
const page = b.contexts()[0].pages().find((p) => p.url().includes('index.html'))
const out = await page.evaluate(() => {
  const box = [...document.querySelectorAll('*')].find((el) => {
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return false
    return el.scrollWidth - el.clientWidth > 2 && String(el.className).includes('mx-auto')
  })
  if (!box) return { found: false }
  const rect = box.getBoundingClientRect()
  const kids = [...box.children].map((c) => {
    const r = c.getBoundingClientRect()
    return { cls: String(c.className).slice(0, 44), right: Math.round(r.right - rect.right), w: Math.round(r.width) }
  })
  return { found: true, scrollW: box.scrollWidth, clientW: box.clientWidth, kids }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
