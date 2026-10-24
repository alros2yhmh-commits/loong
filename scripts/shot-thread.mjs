import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Hamza/Desktop/LOONG/app/win-unpacked/Loong.exe'
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
// a fresh profile sits on onboarding, which renders instead of the shell — mark
// it done and reload so the real interface (and the status bar) exists
await page.evaluate(() => {
  const raw = window.localStorage.getItem('loong.settings')
  const cfg = raw ? JSON.parse(raw) : {}
  cfg.onboarded = true
  window.localStorage.setItem('loong.settings', JSON.stringify(cfg))
})
await page.reload()
await sleep(3000)
// open the sidebar and pick the first saved thread
await page.keyboard.press('Control+k')
await sleep(400)
await page.keyboard.type('thread')
await sleep(300)
await page.keyboard.press('Escape')
await sleep(300)
const first = page.locator('[data-sidebar] button').filter({ hasText: /./ }).nth(2)
if (await first.count()) { await first.click({ timeout: 2000 }).catch(() => {}) }
await sleep(2000)
await page.screenshot({ path: 'shots/audit/06-thread.png' })
const bar = await page.evaluate(() => {
  const f = document.querySelector('footer')
  return f ? f.textContent?.trim().slice(0, 120) : 'NO FOOTER'
})
console.log('status bar:', bar)
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
