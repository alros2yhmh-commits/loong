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
await page.keyboard.press('Escape')
await sleep(300)
await page.keyboard.press('Control+k')
await sleep(700)
await page.screenshot({ path: 'shots/audit/04-palette.png' })
const order = await page.evaluate(() =>
  [...document.querySelectorAll('[role="option"], .ctl')].slice(0, 10).map((e) => e.textContent?.trim().slice(0, 40)),
)
console.log(JSON.stringify(order, null, 1))
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
