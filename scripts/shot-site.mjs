import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, executablePath: 'C:/Users/Hamza/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('file:///C:/Users/Hamza/Desktop/loong-demo/index.html')
await p.waitForTimeout(2500)
/* scroll through so the reveal animations fire, then back to top */
await p.evaluate(async () => {
  const h = document.body.scrollHeight
  for (let y = 0; y <= h; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) }
  window.scrollTo(0, 0)
})
await p.waitForTimeout(1200)
await p.screenshot({ path: 'C:/Users/Hamza/Desktop/film/site-hero.png' })
await p.evaluate(() => window.scrollTo(0, 780))
await p.waitForTimeout(1400)
await p.screenshot({ path: 'C:/Users/Hamza/Desktop/film/site-features.png' })
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await p.waitForTimeout(1400)
await p.screenshot({ path: 'C:/Users/Hamza/Desktop/film/site-footer.png' })
await p.evaluate(() => window.scrollTo(0, 0))
await p.waitForTimeout(600)
await p.screenshot({ path: 'C:/Users/Hamza/Desktop/film/site-full.png', fullPage: true })
console.log('site shots done')
await b.close()
