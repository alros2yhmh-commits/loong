import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { setGlobalDispatcher, Agent } from 'undici'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
const EXE = 'C:/Users/Hamza/Desktop/LOONG/app/win-unpacked/Loong.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await sleep(1500)
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn(EXE, ['--remote-debugging-port=9222'], { env, stdio: 'ignore', cwd: EXE.replace(/Loong.exe$/, '') })
let page = null
for (let i = 0; i < 40 && !page; i++) {
  await sleep(600)
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null)
  if (!b) continue
  for (const c of b.contexts()) for (const p of c.pages()) if (p.url().includes('index.html')) page = p
  if (!page) await b.close().catch(() => {})
}
await sleep(4500)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
/* open the newest saved session that has a plan in it */
const opened = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-sidebar] li button')]
  const row = rows.find((b) => /build mode|update_plan|خطة/i.test(b.textContent ?? '')) ?? rows[0]
  row?.click()
  return Boolean(row)
})
await sleep(3500)
const text = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
console.log('OPENED:', opened)
console.log('HAS PLAN:', /Plan/i.test(text))
console.log('SNIPPET:', JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 260)))
console.log('ERRORS:', errors.length)
await page.screenshot({ path: 'shots/audit/14-plan.png' })
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
