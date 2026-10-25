import { chromium } from 'playwright-core'
import { setGlobalDispatcher, Agent } from 'undici'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

/* Chromium is the JPEG decoder we already have: open the source on a page and
   screenshot it at every size, so each icon is a real PNG. */
const src = ['build/icon.jpg', 'build/icon-src.jpg', 'C:/Users/Hamza/Downloads/icon.jpg']
  .find((p) => existsSync(p))
if (!src) { console.log('NO SOURCE ICON'); process.exit(1) }
const href = pathToFileURL(src).href
const browser = await chromium.launch()
mkdirSync('public/icon', { recursive: true })
for (const size of [512, 256, 128, 64, 48, 32, 16]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<html><body style="margin:0;background:#0e0e10">
       <img src="${href}" style="width:${size}px;height:${size}px;display:block;object-fit:contain">
     </body></html>`,
  )
  await page.waitForTimeout(140)
  writeFileSync(`public/icon/icon-${size}.png`, await page.screenshot({ type: 'png' }))
  await page.close()
}
await browser.close()
writeFileSync('build/icon.png', readFileSync('public/icon/icon-512.png'))
console.log('icons written from', src)
