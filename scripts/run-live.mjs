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
if (!page) { console.log('NO PAGE'); process.exit(1) }
await sleep(5000)

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

/* wait for the composer to exist at all */
const area = page.locator('textarea[aria-label="Message"]')
try {
  await area.waitFor({ state: 'visible', timeout: 20000 })
} catch {
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300))
  console.log('NO COMPOSER. body:', JSON.stringify(body))
  await page.screenshot({ path: 'shots/audit/11-fail.png' })
  try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
  process.exit(1)
}

await area.fill('Reply with exactly this sentence and nothing else: hello from loong')
await page.keyboard.press('Enter')

const deadline = Date.now() + 420_000
let reply = ''
let streamed = false
while (Date.now() < deadline) {
  await sleep(1500)
  const t = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
  if (/working/.test(t)) streamed = true
  const m = t.match(/Loong\s*\n([\s\S]{3,300}?)(?:\n⏎ send|\n\+ |\n· |$)/)
  if (m && m[1].trim() && !/working/.test(m[1])) { reply = m[1].trim(); break }
}

console.log('STREAMED    :', streamed)
console.log('REPLY       :', JSON.stringify(reply.slice(0, 180)))
const bar = await page.evaluate(() => document.querySelector('footer')?.textContent?.trim().replace(/\s+/g, ' '))
console.log('FLOOR BAR   :', bar)
console.log('CONSOLE ERRS:', errors.length)
await page.screenshot({ path: 'shots/audit/12-reply.png' })
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
