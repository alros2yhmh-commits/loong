import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Hamza/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const b = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
p.on('pageerror', (e) => console.log('EXCEPTION:', e.message.slice(0, 150)))
await p.goto('file:///C:/Users/Hamza/Desktop/film/film.html')
await p.waitForTimeout(4000)
const shots = [[5,'t05-opening'],[14,'t14-ask'],[33,'t33-write'],[80,'t80-hero'],[110,'t110-stat'],[160,'t160-outro']]
for (const [t, name] of shots) {
  await p.evaluate((tt) => window.__seek(tt), t)
  await p.waitForTimeout(1400)
  await p.screenshot({ path: `C:/Users/Hamza/Desktop/film/prev-${name}.png` })
  console.log('shot', name)
}
await b.close()
