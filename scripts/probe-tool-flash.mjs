import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await sleep(1500)
const { spawn } = await import('node:child_process')
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn('C:/Users/Hamza/Desktop/LoongApp/Loong.exe', ['--remote-debugging-port=9222'], { env, stdio: 'ignore' })
let page = null
for (let i = 0; i < 40 && !page; i++) {
  await sleep(1000)
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null)
  if (!b) continue
  for (const c of b.contexts()) for (const p of c.pages()) if (p.url().includes('index.html')) page = p
  if (!page) await b.close().catch(() => {})
}
for (let i = 0; i < 30 && page; i++) { if (await page.evaluate(() => Boolean(window.loong?.token))) break; await sleep(500) }
const token = await page.evaluate(() => window.loong.token())
console.log('sending a grep run…')
await page.evaluate(async (tok) => {
  await fetch('http://127.0.0.1:5274/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-loong-token': tok },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Use the grep tool to search for "export function" in server/config.ts, then stop.' }], config: { provider: 'openrouter', model: 'cohere/north-mini-code:free' }, mode: 'agent', trust: 'auto' }),
  })
}, token)
await sleep(25000)
console.log('done')
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
process.exit(0)
