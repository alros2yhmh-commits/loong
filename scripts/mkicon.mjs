import { chromium } from 'playwright-core'
import { setGlobalDispatcher, Agent } from 'undici'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

/* Chromium is the decoder we already have: open the JPEG on a white page and
   screenshot it at each size, so every icon is a real PNG. */
const src = pathToFileURL('C:/Users/Hamza/Downloads/icon.jpg').href
const browser = await chromium.launch()
mkdirSync('public/icon', { recursive: true })
for (const size of [256, 128, 64, 48, 32, 16]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<html><body style="margin:0;background:#fff">
       <img src="${src}" style="width:${size}px;height:${size}px;display:block;object-fit:contain">
     </body></html>`,
  )
  await page.waitForTimeout(120)
  const buf = await page.screenshot({ omitBackground: false, type: 'png' })
  writeFileSync(`public/icon/icon-${size}.png`, buf)
  await page.close()
}
await browser.close()
writeFileSync('build/icon.png', readFileSync('public/icon/icon-256.png'))
console.log('icons written')
