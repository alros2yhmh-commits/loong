/* which child process appears when a message is sent? poll the console
   processes while a run starts. */
import { spawn, execSync } from 'node:child_process'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WATCH = ['cmd.exe', 'conhost.exe', 'where.exe', 'rg.exe']
const seen = new Map()
const poll = setInterval(() => {
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true })
    for (const line of out.split('\n')) {
      for (const w of WATCH) {
        if (line.toLowerCase().includes(`"${w}"`)) seen.set(w, (seen.get(w) ?? 0) + 1)
      }
    }
  } catch {}
}, 120)
const agent = spawn('node', ['--experimental-strip-types', 'server/start.ts'], {
  env: { ...process.env, LOONG_WORKSPACE: 'C:/Users/Hamza/Desktop/LOONG', LOONG_PORT: '5290', NO_PROXY: '127.0.0.1,localhost' },
  stdio: 'ignore',
})
await sleep(4000)
const res = await fetch('http://127.0.0.1:5290/api/agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], config: { provider: 'openrouter', model: 'cohere/north-mini-code:free' }, mode: 'agent', trust: 'ask' }),
}).catch(() => null)
console.log('run started:', res ? res.status : 'no response')
await sleep(8000)
clearInterval(poll)
console.log('console processes seen:', Object.fromEntries(seen))
try { execSync('taskkill /F /PID ' + agent.pid, { stdio: 'ignore' }) } catch {}
process.exit(0)
