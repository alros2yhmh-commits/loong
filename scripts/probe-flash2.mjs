import { spawn, execSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pids = { cmd: new Set(), conhost: new Set(), where: new Set() }
const poll = setInterval(() => {
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true })
    for (const line of out.split('\n')) {
      const cols = line.split('","').map((c) => c.replace(/"/g, ''))
      if (cols.length < 2) continue
      const name = cols[0].toLowerCase()
      const pid = cols[1]
      if (name === 'cmd.exe') pids.cmd.add(pid)
      if (name === 'conhost.exe') pids.conhost.add(pid)
      if (name === 'where.exe') pids.where.add(pid)
    }
  } catch {}
}, 100)
const agent = spawn('node', ['--experimental-strip-types', 'server/start.ts'], {
  env: { ...process.env, LOONG_WORKSPACE: 'C:/Users/Hamza/Desktop/LOONG', LOONG_PORT: '5291', NO_PROXY: '127.0.0.1,localhost' },
  stdio: 'ignore',
})
await sleep(4000)
const res = await fetch('http://127.0.0.1:5291/api/agent', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], config: { provider: 'openrouter', model: 'cohere/north-mini-code:free' }, mode: 'agent', trust: 'ask' }),
})
const reader = res.body.getReader()
let text = ''
const t0 = Date.now()
while (Date.now() - t0 < 15000) {
  const { done, value } = await Promise.race([reader.read(), sleep(15000).then(() => ({ done: true }))])
  if (done) break
  text += new TextDecoder().decode(value)
}
clearInterval(poll)
console.log('distinct PIDs — cmd:', [...pids.cmd], 'conhost:', [...pids.conhost].length, 'where:', [...pids.where])
console.log('tool calls in stream:', (text.match(/"type":"TOOL_CALL_START"/g) || []).length)
console.log('tools:', [...new Set([...text.matchAll(/"toolCallName":"([^"]+)"/g)].map((m) => m[1]))])
try { execSync('taskkill /F /PID ' + agent.pid, { stdio: 'ignore' }) } catch {}
process.exit(0)
