import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
const EXE = null
const DUR = 182
const out = mkdtempSync(tmpdir() + '/loongfilm-')
const b = await chromium.launch({ headless: true, ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
})
const p = await ctx.newPage()
p.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text().slice(0, 200)) })
p.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message.slice(0, 200)))
await p.goto('file:///C:/Users/Hamza/Desktop/film/film.html')
console.log('film running for', DUR, 'seconds...')
await p.waitForTimeout(DUR * 1000)
await ctx.close()
await b.close()
console.log('RECORDED_IN:' + out)
