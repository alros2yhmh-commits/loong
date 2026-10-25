import { spawn, execSync } from 'node:child_process'

/* ---------------------------------------------------------------------------
   Diagnose the run, against the real agent with the real endpoint.

   It prints every event with a timestamp, so a run that stops "for no reason"
   stops having a mystery: the last event before the stop IS the reason.
   --------------------------------------------------------------------------- */

const EXE = 'C:/Users/Hamza/Desktop/LOONG/app/win-unpacked/Loong.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://127.0.0.1:5274'

try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
await sleep(1500)
const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost' }
delete env.ELECTRON_RUN_AS_NODE
spawn(EXE, [], { env, stdio: 'ignore', cwd: EXE.replace(/Loong.exe$/, '') })

for (let i = 0; i < 40; i++) {
  await sleep(700)
  const ok = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)
  if (ok) break
}

/* the key is passed in, never stored: LOONG_DIAG_KEY=... node scripts/diagnose.mjs */
const KEY = process.env.LOONG_DIAG_KEY ?? ''
const URL_ = process.env.LOONG_DIAG_URL ?? 'https://api.apmix.ai/v1'
const MODEL = process.env.LOONG_DIAG_MODEL ?? 'claude-sonnet-4-6-free'

/* 1. the provider, the endpoint, the key */
const put = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}
console.log('settings:', JSON.stringify((await put('/api/settings', { settings: { provider: 'custom', model: MODEL } })).settings))
console.log('keys    :', JSON.stringify(await put('/api/keys', { keys: { custom: KEY }, baseUrls: { custom: URL_ } })))

/* 2. a big prompt, streamed */
const t0 = Date.now()
let lastAt = Date.now()
const res = await fetch(`${BASE}/api/agent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    threadId: `diag-${Date.now()}`,
    messages: [
      {
        role: 'user',
        content:
          'اعمل موقع كامل جميل جدا: صفحة واحدة index.html في المجلد الحالي، فيها hero وقسم ميزات وتذييل، CSS داخلي، تصميم دارك أنيق. استخدم الأدوات فعليا لكتابة الملف، وبعدها اقرأه للتأكد، وبعدها قول لي سطر واحد إن الشغل خلص.',
      },
    ],
    mode: 'agent',
    trust: 'auto',
    config: { provider: 'custom', model: MODEL },
  }),
})

if (!res.ok || !res.body) {
  console.log('HTTP', res.status, await res.text().catch(() => ''))
  process.exit(1)
}

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
const counts = {}
let last = ''
let stop = null
let failed = null

for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let cut = buf.indexOf('\n\n')
  while (cut >= 0) {
    const frame = buf.slice(0, cut)
    buf = buf.slice(cut + 2)
    const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
    if (data && data !== '[DONE]') {
      try {
        const e = JSON.parse(data)
        const key = e.type === 'CUSTOM' ? `CUSTOM:${e.name}` : e.type
        counts[key] = (counts[key] ?? 0) + 1
        last = key
        if (key === 'CUSTOM:loong.stop') stop = e.value
        if (key === 'CUSTOM:loong.run_failed') failed = e.value
        if (key === 'CUSTOM:loong.retry' || key === 'RUN_ERROR') console.log('  !', key, JSON.stringify(e.value ?? e.message ?? '').slice(0, 160))
        if (key === 'TOOL_CALL_START') console.log('  → tool', e.toolCallName)
        if (key === 'TOOL_CALL_RESULT') console.log('    result:', String(e.result ?? '').replace(/\s+/g,' ').slice(0,90))
        if (key === 'TEXT_MESSAGE_CONTENT') process.stdout.write(String(e.delta ?? '').slice(0,60))
      } catch {
        /* keep-alive */
      }
    }
    cut = buf.indexOf('\n\n')
  }
}

console.log('\nELAPSED  :', ((Date.now() - t0) / 1000).toFixed(1) + 's')
console.log('EVENTS   :', JSON.stringify(counts))
console.log('LAST     :', last)
console.log('STOP     :', JSON.stringify(stop))
console.log('FAILED   :', JSON.stringify(failed))
try { execSync('taskkill /F /IM Loong.exe', { stdio: 'ignore' }) } catch {}
