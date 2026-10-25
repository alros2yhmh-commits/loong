import { chromium } from 'playwright-core'
import { setGlobalDispatcher, Agent } from 'undici'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

/* Chromium is the JPEG decoder we already have.

   The previous version built the page with setContent() and an absolute
   file:// <img> — which Chromium refuses to load from an about:blank origin,
   so every icon came out solid black. This writes a real HTML file next to the
   image and navigates to it, so the file: origin can read the file: image. */
const src = ['build/icon.jpg', 'build/icon-src.jpg'].map((p) => resolve(p)).find((p) => existsSync(p))
if (!src) { console.log('NO SOURCE ICON'); process.exit(1) }

const browser = await chromium.launch()
mkdirSync('public/icon', { recursive: true })

for (const size of [512, 256, 128, 64, 48, 32, 16]) {
  const html = resolve(`build/_icon-${size}.html`)
  writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:#ffffff">
       <img src="${pathToFileURL(src).href}" style="width:${size}px;height:${size}px;display:block;object-fit:contain">
     </body></html>`,
  )
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
  /* wait for the decode, not for a timer */
  await page.evaluate(() => {
    const img = document.querySelector('img')
    return img && img.complete ? true : new Promise((r) => { img.onload = () => r(true); img.onerror = () => r(false) })
  })
  const buf = await page.screenshot({ type: 'png' })
  writeFileSync(`public/icon/icon-${size}.png`, buf)
  await page.close()
  rmSync(html, { force: true })
}

await browser.close()
writeFileSync('build/icon.png', readFileSync('public/icon/icon-512.png'))

/* prove it is not a black square: sample the middle and count distinct colours */
const { PNG } = await import('pngjs')
const png = PNG.sync.read(readFileSync('public/icon/icon-512.png'))
const seen = new Set()
for (let i = 0; i < png.data.length; i += 4 * 97) {
  seen.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
}
console.log('icon written from', src)
console.log('distinct colours sampled:', seen.size, seen.size > 3 ? '(has content)' : '(SUSPECT: flat)')
