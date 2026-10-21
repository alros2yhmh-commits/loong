/* End-to-end verification against the real local agent.
   Run with the agent server and Vite already up. */
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = 'shots'
const TARGET = resolve('HELLO.md')

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: 1512, height: 900 },
  deviceScaleFactor: 2,
})

const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})

const step = (s) => console.log(`[verify] ${s}`)

rmSync(TARGET, { force: true })
await page.goto('http://localhost:5273/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const health = await page.evaluate(() =>
  fetch('/api/health').then((r) => r.json()).catch(() => null),
)
step(`agent health: ${health ? `ok, workspace ${health.workspace}` : 'UNREACHABLE'}`)

step('sending a write request that must be gated…')
await page
  .locator('textarea')
  .fill(
    'Create a file called HELLO.md in the workspace root containing exactly this line: ' +
      'hello from the agent. Use the write_file tool.',
  )
await page.keyboard.press('Enter')

let gated = false
try {
  await page.waitForSelector('[data-approve]', { timeout: 180_000 })
  gated = true
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/13-live-approval.png` })
  const card = await page.evaluate(() => {
    const main = document.querySelector('main')
    return [...main.querySelectorAll('p')]
      .map((e) => e.textContent ?? '')
      .filter((t) => t.length > 15)
      .slice(-3)
  })
  step(`gate appeared: ${JSON.stringify(card)}`)
} catch {
  await page.screenshot({ path: `${OUT}/13-no-gate.png` })
  step('NO GATE APPEARED — the model did not call write_file')
}

if (gated) {
  const beforeExists = existsSync(TARGET)
  step(`before approving, HELLO.md exists: ${beforeExists}`)

  await page.locator('[data-approve]').click()
  step('approved; waiting for the run to finish…')
  await page.waitForTimeout(40_000)
  await page.screenshot({ path: `${OUT}/14-live-after-approve.png` })

  const after = existsSync(TARGET)
  step(`after approving, HELLO.md exists: ${after}`)
  if (after) step(`contents: ${JSON.stringify(readFileSync(TARGET, 'utf8').trim())}`)
}

console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : '[verify] no console errors')
await browser.close()
