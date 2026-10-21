/* ---------------------------------------------------------------------------
   Verifies the two interactive paths the interface never had: ask_user and
   propose_changes. Both park a real run on a real provider and are answered
   over HTTP, exactly as the UI does.
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
  const t = await res.text()
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

function readSSE(body, onEvent, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    fetch(BASE + '/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`agent -> ${res.status}`)
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
              } catch (e) {
                console.log('   handler error:', e.message)
              }
            }
            cut = buffer.indexOf('\n\n')
          }
        }
        resolve()
      })
      .catch(reject)
  })
}

/* ------------------------------------------------------------------------ */

const PROBE_DIR = '_verify_tmp'

async function runCase(label, message, { expectTool, answerText }) {
  const tools = []
  const questions = []
  const approvals = []
  const errors = []
  let text = ''

  console.log(`\n=== ${label} ===`)

  await readSSE(
    {
      threadId: `verify-${label}`,
      mode: 'agent',
      messages: [{ role: 'user', content: message }],
      config: { provider: 'openrouter', model: MODEL, apiKey: KEY },
    },
    async (e) => {
      if (e.type === 'TOOL_CALL_START') tools.push(e.toolCallName)
      if (e.type === 'TOOL_CALL_RESULT') {
        const out = String(e.content ?? '')
        console.log(`   result ${e.toolName ?? '?'} (${e.ms ?? 0}ms): ${out.slice(0, 80).replace(/\n/g, ' ')}`)
      }
      if (e.type === 'TEXT_MESSAGE_CONTENT') text += String(e.delta ?? '')
      if (e.type === 'RUN_ERROR') errors.push(String(e.message ?? ''))
      if (e.type === 'CUSTOM' && e.name === 'loong.question') {
        const v = e.value
        questions.push(v)
        console.log(`   QUESTION: ${String(v.question).slice(0, 100)}`)
        await post(`/api/questions/${encodeURIComponent(v.id)}`, { answer: answerText })
        console.log(`   -> answered: ${answerText}`)
      }
      if (e.type === 'CUSTOM' && e.name === 'loong.approval_requested') {
        const v = e.value
        approvals.push(v)
        console.log(`   APPROVAL: ${v.tool} — ${String(v.title).slice(0, 60)}`)
        await post(`/api/approvals/${encodeURIComponent(v.id)}`, { approved: true })
        console.log('   -> approved')
      }
    },
  )

  const used = tools.includes(expectTool)
  console.log(`   tools: ${[...new Set(tools)].join(', ') || '(none)'}`)
  console.log(`   asked ${questions.length} question(s), ${approvals.length} approval(s)`)
  console.log(`   errors: ${errors.join(' | ') || 'none'}`)
  console.log(`   ${expectTool} used: ${used ? 'YES' : 'NO'}`)
  if (text) console.log(`   reply: ${text.slice(0, 200).replace(/\n/g, ' ')}`)
  return { used, questions: questions.length, approvals: approvals.length, errors }
}

const ask = await runCase(
  'ask_user',
  'Ask me exactly one question with ask_user: whether to name the file NOTES.md or NOTES.txt. Then stop and wait for my answer.',
  { expectTool: 'ask_user', answerText: 'NOTES.md' },
)

const batch = await runCase(
  'propose_changes',
  `Create two files in the folder "${PROBE_DIR}": "a.txt" containing "alpha" and "b.txt" containing "beta". Use propose_changes so both go through one approval. Do not use write_file.`,
  { expectTool: 'propose_changes', answerText: '' },
)

console.log('\n=== verdict ===')
console.log(`  ask_user used          ${ask.used ? 'YES' : 'NO'}  (questions asked: ${ask.questions})`)
console.log(`  propose_changes used   ${batch.used ? 'YES' : 'NO'}  (approvals asked: ${batch.approvals})`)
console.log(`  run errors             ${ask.errors.length + batch.errors.length}`)

// the batch should have actually written both files
const fs = await import('node:fs/promises')
const written = []
for (const f of ['a.txt', 'b.txt']) {
  try {
    written.push(`${f} = ${(await fs.readFile(`${PROBE_DIR}/${f}`, 'utf8')).trim()}`)
  } catch {
    written.push(`${f} = MISSING`)
  }
}
console.log(`  files on disk          ${written.join(', ')}`)
await fs.rm(PROBE_DIR, { recursive: true, force: true })

const pass = ask.used && ask.questions > 0 && batch.used && batch.approvals > 0 && !written.some((w) => w.includes('MISSING'))
console.log(`\n  RESULT: ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
