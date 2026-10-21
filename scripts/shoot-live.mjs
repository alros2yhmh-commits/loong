/* Drives the interface in a real browser against the real agent, and captures
   the things the plan was meant to fix: a plan you can see, a tool card that
   appears the instant it starts, and mixed Arabic/English text laid out
   correctly. */
import { chromium } from 'playwright-core'

const KEY = process.env.LOONG_OPENROUTER_KEY
const MODEL = process.argv[2] || 'nvidia/nemotron-3-super-120b-a12b:free'
const OUT = 'shots'

if (!KEY) {
  console.error('set LOONG_OPENROUTER_KEY first')
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({
  viewport: { width: 1512, height: 900 },
  deviceScaleFactor: 2,
})
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

/* point the interface at the real provider before it boots */
await page.addInitScript(
  ([key, model]) => {
    window.localStorage.setItem(
      'loong.settings.v1',
      JSON.stringify({
        provider: 'openrouter',
        model,
        apiKey: key,
        theme: 'dark',
        soundEnabled: false,
        volume: 0.7,
        motion: 'system',
        threadFontSize: 13.5,
      }),
    )
  },
  [KEY, MODEL],
)

await page.goto('http://localhost:5273/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/20-ui-start.png` })

/* the workspace badge must show what the agent is working on */
const badge = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /Flow/.test(b.textContent ?? ''),
  )
  return btn?.textContent?.trim() ?? '(no workspace badge)'
})
console.log('workspace badge :', badge)

/* open the workspace popover so the picker is provable */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /Flow/.test(b.textContent ?? ''),
  )
  ;(btn as HTMLButtonElement | null)?.click()
})
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/21-ui-workspace.png`, clip: { x: 20, y: 30, width: 500, height: 380 } })
console.log('workspace pop   : captured')

/* a task that must use the plan tool and a live tool */
await page.locator('textarea').fill(
  'Use update_plan first with 2 steps for "find the current React version", then call web_search for "current React version 2026". Then answer in one line.',
)
await page.locator('textarea').press('Enter')

/* capture while the tool is running — this is the frame that used to be empty */
for (const at of [2500, 6000, 11000, 16000]) {
  await page.waitForTimeout(at === 2500 ? 2500 : at - (at === 6000 ? 2500 : at === 11000 ? 6000 : 11000))
  const live = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-tool-card]')]
    return cards.map((c) => c.textContent?.slice(0, 70))
  })
  if (live.length) console.log(`live cards @${at}ms:`, live)
  if (at === 6000) await page.screenshot({ path: `${OUT}/22-ui-live-tool.png` })
}

await page.waitForTimeout(15000)
await page.screenshot({ path: `${OUT}/23-ui-after-run.png` })

const hasPlan = await page.evaluate(
  () => (document.body.textContent ?? '').includes('Plan'),
)
console.log('plan visible    :', hasPlan)

/* bidi: the same thread now holds Arabic and English */
await page.locator('textarea').fill(
  'اشرح لي بإيجاز: what is the difference between streaming and blocking in Node.js? ' +
    'جاوب بجملة واحدة بالعربية وجملة واحدة بالإنجليزية معًا.',
)
await page.locator('textarea').press('Enter')
await page.waitForTimeout(22000)
await page.screenshot({ path: `${OUT}/24-ui-bidi.png` })

const mixedSample = await page.evaluate(() => {
  const main = document.querySelector('main')
  const paras = [...(main?.querySelectorAll('p') ?? [])]
    .map((p) => p.textContent ?? '')
    .filter((t) => /[\u0600-\u06FF]/.test(t) && /[A-Za-z]/.test(t))
    .slice(0, 3)
  return paras
})
console.log('mixed paragraphs:', JSON.stringify(mixedSample, null, 1))
console.log('page errors     :', errors.length ? errors.slice(0, 5) : 'none')

await browser.close()
console.log('\nshots written to', OUT)
