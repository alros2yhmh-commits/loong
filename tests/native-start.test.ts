import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native Node24 starts the TypeScript entrypoint without tsx and shuts down cleanly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'loong-native-start-'))
  const child = spawn(process.execPath, ['server/start.ts'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', LOONG_PORT: '0', LOONG_HOST: '127.0.0.1',
      LOONG_DATA_DIR: directory, LOONG_WORKSPACE: directory, LOONG_TOKEN: 'native-test-only-token' },
  })
  let output = '', base: string | undefined
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
    base = /agent server\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]
  })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const exit = once(child, 'exit')
  try {
    const deadline = Date.now() + 10_000
    while (!base && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
    assert.ok(base, `Native startup failed: ${output}`)
    const response = await fetch(base + '/api/health', { headers: { 'x-loong-token': 'native-test-only-token' } })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { workspace: string }).workspace, directory)
    child.kill('SIGTERM')
    await exit
  } finally {
    if (child.exitCode === null) { child.kill('SIGKILL'); await exit }
    rmSync(directory, { recursive: true, force: true })
  }
})
