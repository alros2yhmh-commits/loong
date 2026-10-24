import { chromium } from 'playwright-core'
const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = b.contexts()[0].pages().find((p) => p.url().includes('index.html'))
const out = await page.evaluate(() => {
  const txt = (el) => (el?.textContent ?? '').trim().slice(0, 60)
  /* every button with its accessible name */
  const buttons = [...document.querySelectorAll('button')].map((b) => ({
    label: (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 40),
    cls: String(b.className).slice(0, 30),
  }))
  const noName = buttons.filter((b) => !b.label)
  /* the run bar's numbers */
  const runBar = txt(document.querySelector('[data-run-bar]')) || txt(document.querySelector('.run-bar'))
  /* the clipped elements, with their text */
  const clipped = [...document.querySelectorAll('*')]
    .filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') return false
      return el.scrollWidth - el.clientWidth > 2 && el.clientWidth > 0
    })
    .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 50), text: txt(el), over: el.scrollWidth - el.clientWidth }))
  /* the token text in the header */
  const header = document.body.innerText.slice(0, 400)
  return { noName, clipped: clipped.slice(0, 6), runBar, header }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
