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
const head = await page.evaluate(() => {
  const h = document.querySelector('header')
  return [...(h?.querySelectorAll('*') ?? [])].map((e) => `${e.tagName}:${(e.textContent ?? '').trim().slice(0, 14)}`).join(' | ')
})
console.log('HEADER:', head)
const box = await page.evaluate(() => {
  const ta = document.querySelector('textarea')
  const r = ta?.getBoundingClientRect()
  return r ? { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } : null
})
console.log('TEXTAREA:', JSON.stringify(box))
await page.screenshot({ path: 'shots/audit/13-header.png' })
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
