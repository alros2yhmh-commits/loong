/* ---------------------------------------------------------------------------
   Live check for the tools that were added.

   The suite proves the refusals and the schemas; this proves the tools actually
   talk to the world. It is a script, not a test, because a test that needs the
   internet fails on a train — and a tool that only works in a mock is not a
   tool.

   Run it with a key in the environment, never in a file:

     LOONG_TEST_KEY=sk-or-v1-… node --import tsx scripts/check-tools.mjs
   --------------------------------------------------------------------------- */

import { TOOLS } from '../server/tools.ts'
import { browserAction, closeBrowser } from '../server/browser.ts'
import { setWorkspace } from '../server/config.ts'

setWorkspace(process.cwd())

const key = process.env.LOONG_TEST_KEY
if (!key) {
  console.error('set LOONG_TEST_KEY first — the checks need a real provider key')
  process.exit(2)
}

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failed += 1
}

const call = async (name, input) => String(await TOOLS[name].execute(input, { toolCallId: `live-${name}` }))

/* 1. an authenticated GET with a header — the thing curl was doing */
{
  const out = await call('http_request', {
    url: 'https://openrouter.ai/api/v1/key',
    headers: { Authorization: `Bearer ${key}` },
  })
  check('http_request: GET with an Authorization header', /status: 200/.test(out) && /is_free_tier/.test(out),
    out.split('\n').slice(0, 2).join(' | '))
}

/* 2. a JSON POST — the thing that cost six minutes of cmd.exe quoting */
{
  const out = await call('http_request', {
    url: 'https://httpbin.org/post',
    method: 'POST',
    json: { challenge_key: 'letter-count-1', answer: '4' },
  })
  check('http_request: POST a JSON body', /status: 200/.test(out) && /letter-count-1/.test(out),
    out.split('\n').slice(0, 2).join(' | '))
}

/* 3. a private address is still refused */
{
  const out = await call('http_request', { url: 'http://127.0.0.1:8080/admin' })
  check('http_request: loopback refused', /Refused/.test(out), out.slice(0, 60))
}

/* 4. an image behind a URL, with the token that protects it */
{
  const out = await TOOLS.read_image.execute(
    { path: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png' },
    { toolCallId: 'live-img' },
  )
  const ok = typeof out === 'object' && typeof out.shotBase64 === 'string' && out.shotBase64.length > 1000
  check('read_image: a picture behind a URL', ok, ok ? `${out.shotBase64.length} base64 chars` : String(out).slice(0, 80))
}

/* 5. the browser with headers — and without, so the difference is the proof */
{
  await browserAction('open', 'https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })
  const withHeader = await browserAction('evaluate', 'document.body.innerText')
  const sawJson = /is_free_tier/.test(withHeader.text)
  await browserAction('open', 'https://openrouter.ai/api/v1/key')
  const withoutHeader = await browserAction('evaluate', 'document.body.innerText')
  const sawError = /No auth credentials|401|error/i.test(withoutHeader.text)
  check('browser: open with an Authorization header', sawJson, withHeader.text.slice(0, 80))
  check('browser: the same page without the header is refused', sawError, withoutHeader.text.slice(0, 80))
  await closeBrowser()
}

console.log(failed === 0 ? '\nall live checks passed' : `\n${failed} live check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
