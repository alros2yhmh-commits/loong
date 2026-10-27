/* Exercise the emitted sidecar and native PTY, without a model or user data. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..')
const temp = await mkdtemp(path.join(tmpdir(), 'loong-bundle-'))
const token = randomBytes(24).toString('hex')
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) })
})
const executable = process.env.LOONG_SMOKE_NODE || process.execPath
const child = spawn(executable, [path.join(root, 'dist-agent', 'loong-agent.cjs')], {
  cwd: root, env: { ...process.env, LOONG_PORT: String(port), LOONG_HOST: '127.0.0.1',
    LOONG_DATA_DIR: temp, LOONG_WORKSPACE: temp, LOONG_TOKEN: token },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let output = ''
child.stdout.on('data', (data) => { output += data })
child.stderr.on('data', (data) => { output += data })
let exited = false
child.on('exit', () => { exited = true })
let spawnError = null
child.on('error', (error) => { spawnError = error })
const base = `http://127.0.0.1:${port}`
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (spawnError) throw spawnError
    if (exited) throw new Error(`Sidecar exited before readiness: ${output.slice(-2000)}`)
    try {
      const response = await fetch(base + '/api/health', {
        headers: { 'x-loong-token': token }, signal: AbortSignal.timeout(1500),
      })
      const body = await response.json()
      if (response.ok && body.ok && body.workspace === temp) { ready = true; break }
    } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  assert.ok(ready, `Sidecar not ready: ${output.slice(-2000)}`)
  assert.equal((await fetch(base + '/api/workspace')).status, 401)
  const preflight = await fetch(base + '/api/settings', { method: 'OPTIONS', headers: {
    origin: 'loong://app', 'access-control-request-method': 'PUT',
    'access-control-request-headers': 'content-type,x-loong-token',
  } })
  assert.equal(preflight.status, 204, 'trusted desktop preflight must work without a token')
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'loong://app')
  const workspace = await fetch(base + '/api/workspace', { headers: {
    origin: 'loong://app', 'x-loong-token': token,
  } })
  assert.equal(workspace.status, 200)
  assert.equal((await workspace.json()).workspace, temp)
  const require = createRequire(path.join(root, 'dist-agent', 'loong-agent.cjs'))
  const pty = require('node-pty')
  await new Promise((resolve, reject) => {
    const terminal = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      process.platform === 'win32' ? ['/d', '/c', 'echo loong-native-ready'] : ['-c', 'echo loong-native-ready'],
      { cwd: temp, env: process.env, cols: 80, rows: 24 })
    let text = ''
    const timeout = setTimeout(() => { terminal.kill(); reject(new Error('Native PTY timed out')) }, 6000)
    terminal.onData((data) => { text += data })
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout)
      try { assert.equal(exitCode, 0); assert.match(text, /loong-native-ready/); resolve() } catch (error) { reject(error) }
    })
  })
  console.log('PASS: built agent, authenticated desktop origin, isolated workspace, and native PTY')
} finally {
  child.kill()
  if (!exited) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))])
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
}
