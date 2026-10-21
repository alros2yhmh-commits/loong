import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace } from '../server/config.ts'
import {
  hookMatches,
  loadHooks,
  parseHookConfig,
  runPostToolUse,
  runPreToolUse,
  runSessionStart,
  runStopHooks,
} from '../server/hooks.ts'

/* ---------------------------------------------------------------------------
   Hooks — the project's own code at the seams of the run.

   The shape is Claude Code's on purpose, so these tests assert the same
   contract: a PreToolUse hook that exits 2 blocks the call, stdout becomes
   context, a PostToolUse note rides back into the result, and a Stop hook that
   exits 2 keeps the run working.
   --------------------------------------------------------------------------- */

const original = process.env.LOONG_WORKSPACE
let dir: string

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'loong-hooks-'))
  mkdirSync(join(dir, '.loong'), { recursive: true })
  setWorkspace(dir)
})

after(() => {
  setWorkspace(original ?? process.cwd())
  rmSync(dir, { recursive: true, force: true })
})

function writeHooks(config: unknown) {
  writeFileSync(
    join(dir, '.loong', 'settings.json'),
    JSON.stringify({ hooks: config }, null, 2),
    'utf8',
  )
}

test('a malformed settings file is an empty config, never a throw', () => {
  assert.deepEqual(parseHookConfig('{ not json'), {})
  assert.deepEqual(parseHookConfig('{}'), {})
  assert.deepEqual(parseHookConfig('{"hooks": "nope"}'), {})
  const ok = parseHookConfig('{"hooks": {"PreToolUse": [{"command": "echo hi"}]}}')
  assert.equal(ok.PreToolUse?.length, 1)
})

test('entries without a command are dropped, not kept', () => {
  const cfg = parseHookConfig('{"hooks": {"Stop": [{"matcher": "*"}, {"command": ""}, {"command": "x"}]}}')
  assert.equal(cfg.Stop?.length, 1)
})

test('an empty matcher matches everything; a fragment matches the tool name', () => {
  assert.equal(hookMatches({ command: 'x' }, 'write_file'), true)
  assert.equal(hookMatches({ command: 'x', matcher: '*' }, 'write_file'), true)
  assert.equal(hookMatches({ command: 'x', matcher: 'write' }, 'write_file'), true)
  assert.equal(hookMatches({ command: 'x', matcher: 'shell' }, 'write_file'), false)
})

test('no hooks file means every gate is open', async () => {
  const pre = await runPreToolUse('write_file', { path: 'a.txt' })
  assert.equal(pre.allow, true)
  assert.equal(pre.context, undefined)
  const stop = await runStopHooks()
  assert.equal(stop.done, true)
  assert.equal(await runSessionStart(), '')
})

/* a command that exits 2, on whichever shell the hook will run in */
const BLOCK_CMD =
  process.platform === 'win32'
    ? 'echo blocked by policy & exit /b 2'
    : 'echo blocked by policy; exit 2'

test('a PreToolUse hook that exits 2 blocks the tool, with its reason', async () => {
  writeHooks({
    PreToolUse: [{ matcher: 'write_file', command: BLOCK_CMD }],
  })
  const pre = await runPreToolUse('write_file', { path: 'migrations/001.sql' })
  assert.equal(pre.allow, false)
  assert.match(pre.reason ?? '', /blocked by policy/)
})

test('a PreToolUse hook that passes adds its stdout as context', async () => {
  writeHooks({
    PreToolUse: [{ matcher: 'write', command: 'echo check the licence header' }],
  })
  const pre = await runPreToolUse('write_file', {})
  assert.equal(pre.allow, true)
  assert.match(pre.context ?? '', /licence header/)
})

test('a hook that does not match does not run', async () => {
  writeHooks({
    PreToolUse: [{ matcher: 'shell', command: 'echo should not appear' }],
  })
  const pre = await runPreToolUse('write_file', {})
  assert.equal(pre.allow, true)
  assert.equal(pre.context, undefined)
})

test('a PostToolUse note rides back into the result', async () => {
  writeHooks({
    PostToolUse: [{ matcher: 'write_file', command: 'echo CHANGELOG needs a line' }],
  })
  const note = await runPostToolUse('write_file', {}, 'wrote a.txt')
  assert.match(note, /CHANGELOG/)
})

test('a SessionStart hook is injected as context', async () => {
  writeHooks({
    SessionStart: [{ command: 'echo today is a freeze day' }],
  })
  const text = await runSessionStart()
  assert.match(text, /freeze day/)
})

test('a Stop hook that exits 2 keeps the run going, with its reason', async () => {
  writeHooks({
    Stop: [{ command: BLOCK_CMD }],
  })
  const stop = await runStopHooks()
  assert.equal(stop.done, false)
  assert.match(stop.reason ?? '', /blocked by policy/)
})

test('editing the file takes effect at once — the cache is mtime-keyed', async () => {
  writeHooks({ SessionStart: [{ command: 'echo first' }] })
  assert.match(await runSessionStart(), /first/)
  await new Promise((r) => setTimeout(r, 5))
  writeHooks({ SessionStart: [{ command: 'echo second' }] })
  assert.match(await runSessionStart(), /second/)
})

test('loadHooks reads what was written', () => {
  writeHooks({ Stop: [{ command: 'echo x', timeout: 1234 }] })
  const cfg = loadHooks()
  assert.equal(cfg.Stop?.[0]?.timeout, 1234)
})
