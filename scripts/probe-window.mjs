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
await sleep(3500)
/* the window controls must not overlap content: measure the right padding */
const info = await page.evaluate(() => {
  const h = document.querySelector('header')
  const cs = h ? getComputedStyle(h) : null
  return {
    headerHeight: h ? Math.round(h.getBoundingClientRect().height) : 0,
    appRegion: cs ? cs.getPropertyValue('-webkit-app-region') || cs.getPropertyValue('WebkitAppRegion') : '',
    paddingRight: cs ? cs.paddingRight : '',
    bodyTop: Math.round(document.body.getBoundingClientRect().top),
  }
})
console.log('HEADER:', JSON.stringify(info))
const menuBar = await page.evaluate(() => document.body.innerText.includes('Edit') && document.body.innerText.includes('Window'))
console.log('MENU TEXT IN DOM (should be false):', menuBar)
await page.screenshot({ path: 'shots/audit/15-titlebar.png' })
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
