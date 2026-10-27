/* Exercise the same sidecar, PTY, and restricted CodeAct child under desktop Node. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), args, { cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Desktop Node check exited ${code}`)))
  })
}
try {
  await run([path.join(root, 'scripts', 'smoke-bundle.mjs')])
  await run(['--test', '--import', 'tsx', '--import', './tests/preload.ts', './tests/codeact.test.ts'])
} catch (error) { console.error(error.message); process.exitCode = 1 }
