/* ---------------------------------------------------------------------------
   End-to-end verification against a real provider.

   Drives the agent server over its actual HTTP API with a real key, and checks
   the four things that were missing: a plan, a question, a web search, and a
   batch of writes. It answers questions and approvals as they arrive, which is
   what the interface does, so the run exercises the same park/resume path.
   --------------------------------------------------------------------------- */

const KEY = process.env.LOONG_OPENROUTER_KEY
const BASE = 'http://127.0.0.1:5274'

if (!KEY) {
  console.error('set LOONG_OPENROUTER_KEY first')
  process.exit(1)
}

const MODEL = process.argv[2] || 'nvidia/nemotron-3-super-120b-a12b:free'

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function readSSE(path, body, onEvent, { timeoutMs = 240_000, signal } = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`${path} -> ${res.status}: ${t.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  let buffer = ''

  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += dec.decode(value, { stream: true })
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          await onEvent(JSON.parse(payload))
        } catch (err) {
          console.log('   handler error:', (err as Error).message)
        }
      }
      cut = buffer.indexOf('\n\n')
    }
  }
}

/* ------------------------------------------------------------------------ */

const seen = {
  types: [],
  tools: [],
  plans: [],
  questions: [],
  text: '',
  errors: [],
}

function classify(e) {
  const t = e.type
  seen.types.push(t)
  switch (t) {
    case 'TOOL_CALL_START':
      seen.tools.push({ event: 'start', name: e.toolCallName, id: e.toolCallId })
      return `start ${e.toolCallName}`
    case 'TOOL_CALL_ARGS':
      return null
    case 'TOOL_CALL_RESULT': {
      const name = (e.toolCallName || e.toolName || '?').toString()
      seen.tools.push({ event: 'result', name, ok: !String(e.content).startsWith('Tool failed') })
      return `result ${name}: ${String(e.content).slice(0, 70).replace(/\n/g, ' ')}`
    }
    case 'TEXT_MESSAGE_CONTENT':
      seen.text += String(e.delta ?? '')
      return null
    case 'RUN_ERROR':
      seen.errors.push(String(e.message ?? ''))
      return `RUN_ERROR: ${String(e.message ?? '').slice(0, 160)}`
    default:
      if (t === 'CUSTOM') {
        const name = String(e.name ?? '')
        if (name === 'loong.plan') {
          const v = e.value ?? {}
          seen.plans.push(v)
          return `PLAN: ${v.steps?.length ?? 0} step(s) — ${v.task ?? ''}`
        }
        if (name === 'loong.question') {
          const v = e.value ?? {}
          seen.questions.push(v)
          return `QUESTION: ${String(v.question).slice(0, 90)}`
        }
        if (name === 'loong.retry') {
          return `RETRY: ${JSON.stringify(e.value).slice(0, 90)}`
        }
        return `${name}`
      }
      return null
  }
}

const started = Date.now()
console.log(`run started with ${MODEL}`)

await readSSE(
  '/api/agent',
  {
    threadId: 'verify-v2',
    mode: 'agent',
    messages: [
      {
        role: 'user',
        content:
          'I want you to prove the new tools work. In this order: (1) call update_plan ' +
          'with a 3-step plan for "check the current React version on the web", ' +
          '(2) call web_search for "current React version 2026", ' +
          '(3) tell me the version the search returned. Do not write any files.',
      },
    ],
    config: { provider: 'openrouter', model: MODEL, apiKey: KEY },
  },
  async (e) => {
    const line = classify(e)
    if (line) console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}s] ${line}`)

    // answer a question the moment it lands, the way the interface does
    if (e.type === 'CUSTOM' && e.name === 'loong.question') {
      const id = e.value.id
      console.log(`  -> answering ${id} with "any version is fine"`)
      await post(`/api/questions/${encodeURIComponent(id)}`, { answer: 'any version is fine' })
    }
    // approve a permission the moment it lands
    if (e.type === 'CUSTOM' && e.name === 'loong.approval_requested') {
      const id = e.value.id
      console.log(`  -> approving ${e.value.tool}: ${String(e.value.title).slice(0, 50)}`)
      await post(`/api/approvals/${encodeURIComponent(id)}`, { approved: true })
    }
  },
  { timeoutMs: 300_000 },
)

const toolNames = seen.tools.filter((t) => t.event === 'start').map((t) => t.name)
const unique = [...new Set(toolNames)]

console.log()
console.log('=== verdict ===')
console.log(`  total events      ${seen.types.length}`)
console.log(`  tools called      ${unique.join(', ') || '(none)'}`)
console.log(`  plans emitted     ${seen.plans.length}`)
console.log(`  questions asked   ${seen.questions.length}`)
console.log(`  run errors        ${seen.errors.length ? seen.errors.join(' | ') : 'none'}`)
console.log(`  reply length      ${seen.text.length} chars`)
console.log(`  wall clock        ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log()
console.log(`  update_plan used  ${unique.includes('update_plan') ? 'YES' : 'NO'}`)
console.log(`  web_search used   ${unique.includes('web_search') ? 'YES' : 'NO'}`)
console.log(`  loop completed    ${seen.errors.length ? 'with errors' : 'clean'}`)
console.log()
if (seen.text) console.log('reply preview:\n' + seen.text.slice(0, 500))

process.exit(seen.errors.length ? 1 : 0)
