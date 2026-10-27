import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace, getCapabilities, setCapabilities } from '../server/config.ts'
import { createRunProjectTool, stopProject } from '../server/project-run.ts'

test('a missing project executable returns a tool error without an unhandled spawn error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-missing-executable-'))
  const originalPath = process.env.PATH
  try {
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.1.0"')
    setWorkspace(root)
    process.env.PATH = join(root, 'no-executables')
    const result = await createRunProjectTool('missing-executable', true).execute({ waitMs: 2000 }, {} as never)
    assert.match(String(result), /Tool failed:/)
    assert.doesNotMatch(String(result), /^Started /)
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath
    await stopProject('missing-executable')
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unrelated common-port service cannot be mistaken for the launched project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-quiet-project-'))
  const previous = getCapabilities().browser
  const unrelated = createServer((_request, response) => response.end('unrelated service'))
  try {
    await new Promise<void>((resolve, reject) => { unrelated.once('error', reject); unrelated.listen(3000, '127.0.0.1', resolve) })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node quiet.cjs' } }))
    writeFileSync(join(root, 'quiet.cjs'), 'setTimeout(() => {}, 150)')
    setWorkspace(root)
    setCapabilities({ browser: false })
    const result = await createRunProjectTool('quiet-project', true).execute({ waitMs: 2000 }, {} as never)
    assert.match(String(result), /Tool failed:/)
    assert.doesNotMatch(String(result), /^Started /)
  } finally {
    await stopProject('quiet-project')
    await new Promise<void>((resolve) => unrelated.close(() => resolve()))
    setCapabilities({ browser: previous })
    rmSync(root, { recursive: true, force: true })
  }
})
