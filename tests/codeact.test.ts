/* CodeAct: one program, several operations, one step.
   The program runs in a child Node under `--permission`, so these tests are
   also the proof that the boundary holds. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* the journal lives in DATA_DIR, and DATA_DIR is read when config.ts loads —
   so the throwaway directory has to exist before the first import */
const dataDir = mkdtempSync(join(tmpdir(), 'loong-codeact-data-'))
process.env.LOONG_DATA_DIR = dataDir

const { createCodeTool } = await import('../server/codeact.ts')
const { setWorkspace } = await import('../server/config.ts')
const { runWithRunId } = await import('../server/run-context.ts')

after(() => rmSync(dataDir, { recursive: true, force: true }))

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'loong-codeact-'))
  setWorkspace(dir)
  return dir
}

const run = (code: string, auto = true, timeoutMs?: number) =>
  runWithRunId('test-run', () =>
    createCodeTool(auto, 'test-run').execute(
      timeoutMs ? { code, timeoutMs } : { code },
      { toolCallId: 't' } as never,
    ),
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

test('a runaway loop is killed, not awaited', async () => {
  fresh()
  const out = await run('while (true) {}', true, 500)
  assert.match(out, /exceeded|exited early/i)
})

test('sh is refused unless the run is full-trust', async () => {
  fresh()
  const out = await run('await sh("echo hi")', false)
  assert.match(out, /not available/i)
})

/* ---------------------------------------------------------------------------
   The boundary. Under the old `vm` implementation each of these succeeded:
   the context was handed the host Object, so `Object.constructor` was the host
   Function, and from there the host realm — require, process, child_process.
   --------------------------------------------------------------------------- */

test('the host realm is not reachable from the program', async () => {
  fresh()
  const out = await run(
    'const f = Object.constructor("return process"); log(typeof f === "function" ? "reached" : "blocked")',
  )
  /* code generation from strings is disabled, so this throws before it returns */
  assert.match(out, /\[error\]/i)
  assert.doesNotMatch(out, /reached/)
})

test('the program cannot read a file outside the workspace directly', async () => {
  const dir = fresh()
  const secret = join(tmpdir(), 'loong-codeact-secret.txt')
  writeFileSync(secret, 'top-secret')
  const out = await run(
    `try { const m = await import("node:fs"); log("GOT:" + m.readFileSync(${JSON.stringify(secret)}, "utf8")) } catch (e) { log("denied") }`,
  )
  assert.doesNotMatch(out, /top-secret/)
  assert.match(out, /denied|\[error\]/i)
  assert.ok(existsSync(dir))
})

test('the program cannot spawn a process', async () => {
  fresh()
  const marker = join(tmpdir(), 'loong-codeact-spawned.txt')
  if (existsSync(marker)) rmSync(marker)
  const out = await run(
    `try { const cp = await import("node:child_process"); cp.execSync("node -e \\"require('fs').writeFileSync(${JSON.stringify(marker)},'pwned')\\""); log("spawned") } catch (e) { log("denied") }`,
  )
  assert.doesNotMatch(out, /spawned/)
  assert.equal(existsSync(marker), false, 'the sandbox must not be able to start a process')
})

test('the program has no network', async () => {
  fresh()
  const out = await run(
    'try { await fetch("http://169.254.169.254/latest/meta-data/"); log("NET-OPEN") } catch (e) { log("net-denied") }',
  )
  assert.doesNotMatch(out, /NET-OPEN/)
  assert.match(out, /net-denied|\[error\]/i)
})

test('fs.append extends a file instead of replacing it', async () => {
  const dir = fresh()
  writeFileSync(join(dir, 'log.txt'), 'one\n')
  await run('await fs.append("log.txt", "two\\n")')
  assert.equal(readFileSync(join(dir, 'log.txt'), 'utf8'), 'one\ntwo\n')
})
