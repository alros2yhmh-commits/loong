/* CodeAct: one program, several operations, one step. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodeTool } from '../server/codeact.ts'
import { setWorkspace } from '../server/config.ts'
import { runWithRunId } from '../server/run-context.ts'

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'loong-codeact-'))
  setWorkspace(dir)
  return dir
}

const run = (code: string, auto = true) =>
  runWithRunId('test-run', () =>
    createCodeTool(auto).execute({ code }, { toolCallId: 't' } as never),
  ) as Promise<string>

test('a loop over files becomes one step', async () => {
  const dir = fresh()
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.ts'), 'const TODO = 1')
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const ok = 1')
  const out = await run(
    'const files = await fs.list("src"); for (const f of files) { const t = await fs.read("src/" + f); if (t.includes("TODO")) log("hit", f) }',
  )
  assert.match(out, /hit a\.ts/)
  assert.doesNotMatch(out, /hit b\.ts/)
})

test('a write lands on disk and reports nothing to print', async () => {
  const dir = fresh()
  const out = await run('await fs.write("out.txt", "hello")')
  assert.equal(readFileSync(join(dir, 'out.txt'), 'utf8'), 'hello')
  assert.match(out, /printed nothing/)
})

test('a path outside the workspace is refused', async () => {
  fresh()
  const out = await run('await fs.read("../outside.txt")')
  assert.match(out, /error/i)
})

test('an infinite loop is cut off by the timeout', async () => {
  fresh()
  const out = await run('while (true) {}', true)
  assert.match(out, /exceeded|timed out|Script execution/i)
})

test('sh is refused unless the run is full-trust', async () => {
  fresh()
  const out = await run('await sh("echo hi")', false)
  assert.match(out, /not available/i)
})
