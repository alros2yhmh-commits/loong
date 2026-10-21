import { spawn, execSync } from 'node:child_process'
import { chromium } from 'playwright-core'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await sleep(1500)
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn('C:/Users/Hamza/Desktop/Flow/app/win-unpacked/Loong.exe', ['--remote-debugging-port=9222'], { env, stdio: 'ignore' })
await sleep(15000)
const b = await chromium.connectOverCDP('http://127.0.0.1:9222').catch((e) => { console.log('connect error:', e.message.slice(0, 120)); return null })
if (!b) process.exit(1)
console.log('contexts:', b.contexts().length)
for (const c of b.contexts()) {
  const pages = c.pages()
  console.log(' pages:', pages.length, pages.map((p) => p.url().slice(0, 80)))
}
await b.close().catch(() => {})
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
