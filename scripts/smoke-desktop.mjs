import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const index = process.argv.indexOf('--packaged')
const executable = index >= 0 ? process.argv[index + 1] : require('electron')
if (!executable) throw new Error('Pass a packaged executable path after --packaged')
const temp = await mkdtemp(path.join(tmpdir(), 'loong-desktop-'))
const env = { ...process.env, LOONG_DATA_DIR: temp, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_CACHE_HOME: path.join(temp, 'cache') }
delete env.ELECTRON_RUN_AS_NODE
const flags = process.env.LOONG_DISABLE_SANDBOX === '1' ? ['--no-sandbox'] : []
const args = index >= 0 ? [...flags, '--smoke-test'] : [...flags, root, '--smoke-test']
const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let output = ''
child.stdout.on('data', (data) => { output += data; process.stdout.write(data) })
child.stderr.on('data', (data) => process.stderr.write(data))
const timer = setTimeout(() => child.kill(), 45000)
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', resolve)
  })
  if (code !== 0 || !output.includes('[loong-smoke]')) throw new Error(`Desktop smoke failed (exit ${code})`)
} catch (error) {
  const startup = await readFile(path.join(temp, 'agent-startup.log'), 'utf8').catch(() => '')
  if (startup) console.error(startup.slice(-8000))
  throw error
} finally {
  clearTimeout(timer)
  child.kill()
  await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
}
