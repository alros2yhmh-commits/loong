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
await sleep(4000)
/* Ask mode: no tools, so the run is a single turn and the reply is text */
await page.locator('button[aria-label="Set mode to Ask"]').click()
await page.locator('textarea[aria-label="Message"]').fill('Reply with exactly: hello from loong')
await page.keyboard.press('Enter')
let replied = ''
for (let i = 0; i < 90; i++) {
  await sleep(2000)
  const t = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
  const m = t.match(/Loong\s*\n([\s\S]{4,300}?)(?:\n⏎|\n\+ agent|$)/)
  if (m && m[1].trim() && !/working/.test(m[1])) { replied = m[1].trim(); break }
}
console.log('AGENT REPLY :', JSON.stringify(replied.slice(0, 200)))
const bar = await page.evaluate(() => document.querySelector('footer')?.textContent?.trim().replace(/\s+/g, ' '))
console.log('STATUS BAR  :', bar)
await page.screenshot({ path: 'shots/audit/09-run.png' })
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
