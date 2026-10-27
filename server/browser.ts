import { chromium, type Browser, type Page } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   The agent's eyes, take one: a real browser.

   "It cannot run the app and watch it work" was one of the loudest complaints.
   The fix is a browser the agent drives itself — and the important half is not
   the screenshot, it is the SNAPSHOT: a text tree of the live page plus its
   console errors. Text is what a model can actually reason about; a picture is
   what a human can look at. So every action returns text, and the screenshot
   exists for the reader.

   playwright-core ships no browser of its own — it drives the Edge or Chrome
   already on the machine, which keeps the packaged app small.
   --------------------------------------------------------------------------- */

let browser: Browser | null = null
let page: Page | null = null
let consoleErrors: string[] = []
let pageErrors: string[] = []

/** screenshots live in the OS temp dir — never inside the reader's project */
export function shotsDir(): string {
  const dir = join(tmpdir(), 'loong-shots')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Edge ships with every Windows machine; Chrome is the fallback. */
function findBrowser(): string | null {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

export function browserAvailable(): boolean {
  return findBrowser() !== null
}

/** the last browser error, or null when the browser is healthy */
export async function browserStatus(): Promise<{ running: boolean; error?: string }> {
  try {
    if (!browser || !page) return { running: false }
    await page.title()
    return { running: true }
  } catch (err) {
    return { running: false, error: (err as Error).message }
  }
}

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page
  const exe = findBrowser()
  if (!exe) throw new Error('No Edge or Chrome found on this machine.')
  consoleErrors = []
  pageErrors = []
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)))
  return page
}

/** a readable text snapshot: title, url, landmarks, the visible control tree */
/* The page walker is a string, not a function.
   Playwright serialises a function with `toString()`, and esbuild's `keepNames`
   (which tsx turns on) injects a `__name(...)` call into every named function.
   That helper exists in Node, not in the page, so the evaluation dies with
   "ReferenceError: __name is not defined". A string has no closure to lose. */
const SNAPSHOT_SCRIPT = `(() => {
  const lines = []
  const title = document.title || '(untitled)'
  lines.push('TITLE: ' + title)
  lines.push('URL: ' + location.href)
  const walk = (el, depth) => {
    if (depth > 6 || lines.length > 400) return
    const tag = el.tagName.toLowerCase()
    const skip = ['script', 'style', 'svg', 'path', 'meta', 'link', 'noscript']
    if (skip.includes(tag)) return
    const text = (el.innerText || '').trim()
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || '').trim())
      .join(' ')
      .trim()
    const label = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.value ?? own ?? text ?? ''
    const interesting = ['a', 'button', 'input', 'select', 'textarea', 'h1', 'h2', 'h3', 'summary', '[role=button]']
    if (interesting.includes(tag) || el.getAttribute('role') === 'button') {
      const t = (label || text || '').replace(/\\s+/g, ' ').slice(0, 80)
      if (t) lines.push('  '.repeat(depth) + '<' + tag + '> ' + t)
    }
    for (const child of Array.from(el.children)) walk(child, depth + 1)
  }
  walk(document.body, 0)
  return lines
})()`

async function snapshot(p: Page): Promise<string> {
  const info = (await p.evaluate(SNAPSHOT_SCRIPT)) as string[]
  return info.join('\n')
}

function errorReport(): string {
  const out: string[] = []
  if (consoleErrors.length) {
    out.push(`CONSOLE ERRORS (${consoleErrors.length}):`)
    out.push(...consoleErrors.slice(0, 20).map((e) => `  ${e}`))
  }
  if (pageErrors.length) {
    out.push(`PAGE ERRORS (${pageErrors.length}):`)
    out.push(...pageErrors.slice(0, 20).map((e) => `  ${e}`))
  }
  if (!out.length) out.push('No console errors or page errors.')
  return out.join('\n')
}

export interface BrowserResult {
  text: string
  /** absolute path to a fresh screenshot, when one was taken */
  shot?: string
  /** base64 PNG for the model to look at — only set on screenshot */
  shotBase64?: string
}

/** one browser action. The whole eye, in one function the tools call. */
export async function browserAction(
  action: 'open' | 'snapshot' | 'screenshot' | 'click' | 'type' | 'evaluate' | 'close',
  arg: string,
  /** headers every request from this page carries — an API behind a bearer
      token could not be opened at all before this */
  headers?: Record<string, string>,
): Promise<BrowserResult> {
  if (action === 'close') {
    await closeBrowser()
    return { text: 'Browser closed.' }
  }

  const p = await ensurePage()

  if (action === 'open') {
    let url = arg.trim()
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`
    /* headers are set on the context, before the first request leaves — a page
       that needs a token is otherwise just a 401 with no way to answer it */
    if (headers && Object.keys(headers).length > 0) {
      await p.context().setExtraHTTPHeaders(headers)
    } else {
      await p.context().setExtraHTTPHeaders({})
    }
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((err) => {
      throw new Error(`Could not load ${url}: ${(err as Error).message.split('\n')[0]}`)
    })
    await p.waitForTimeout(600)
    const snap = await snapshot(p)
    return { text: `Opened ${url}\n\n${snap}\n\n${errorReport()}` }
  }

  if (action === 'snapshot') {
    return { text: `${await snapshot(p)}\n\n${errorReport()}` }
  }

  if (action === 'screenshot') {
    const name = `shot-${Date.now()}.png`
    const abs = join(shotsDir(), name)
    await p.screenshot({ path: abs, fullPage: arg.trim() === 'full' })
    const b64 = readFileSync(abs).toString('base64')
    return {
      text: `Screenshot saved: ${abs} — it is also shown to the user in the conversation. Look at it with the image, and use snapshot if you need the page as text.`,
      shot: abs,
      shotBase64: b64,
    }
  }

  if (action === 'click') {
    const sel = arg.trim()
    await p.click(sel, { timeout: 8_000 })
    await p.waitForTimeout(400)
    return { text: `Clicked ${sel}\n\n${await snapshot(p)}` }
  }

  if (action === 'type') {
    const [sel, ...rest] = arg.split('||').map((s) => s.trim())
    const text = rest.join('||')
    if (!sel || !text) throw new Error('type takes "selector || text".')
    await p.fill(sel, text, { timeout: 8_000 })
    return { text: `Typed into ${sel}.` }
  }

  /* evaluate: run JS in the page and return what it produced as text */
  const value = await p.evaluate(arg)
  return { text: `Result: ${JSON.stringify(value).slice(0, 4000)}` }
}

export async function closeBrowser(): Promise<void> {
  try {
    await page?.close()
  } catch {}
  try {
    await browser?.close()
  } catch {}
  page = null
  browser = null
}

process.on('exit', () => {
  void closeBrowser()
})
