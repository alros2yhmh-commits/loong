/* Screenshot the running app so the design can be inspected, not assumed.
   Timings below are derived from the fixture's own delays, not guessed. */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:5273/'
const OUT = 'shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: 1512, height: 945 },
  deviceScaleFactor: 2,
})
await page.addInitScript(() => window.localStorage.clear())

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

await page.goto(URL, { waitUntil: 'domcontentloaded' })

await page.waitForTimeout(420)
await shot('01-empty')

await page.waitForTimeout(4100)
await shot('02-thinking')

/* the run stops here and will not move again until a human answers */
await page.waitForSelector('[data-approve]', { timeout: 20000 })
await page.waitForTimeout(500)
await shot('03-approval')

await page.locator('[data-approve]').click()
await page.waitForTimeout(6500)
await shot('04-clamped')

await page.locator('button', { hasText: 'Read more' }).first().click()
await page.waitForTimeout(800)
await shot('05-expanded')

/* settings, which is where the provider lives */
await page.keyboard.press('Control+,')
await page.waitForTimeout(900)
await shot('06-settings')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* drag the drawer wider, then pin it */
await page.mouse.move(1511, 470)
await page.waitForTimeout(1000)
const gripX = 1512 - 320
await page.mouse.move(gripX, 470)
await page.mouse.down()
await page.mouse.move(gripX - 160, 470, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(700)
await shot('07-resized-drawer')

/* light theme, for the ramp read from the other end */
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.keyboard.type('light')
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
await shot('08-light')

console.log(problems.length ? problems.join('\n') : 'no console errors')
await browser.close()
