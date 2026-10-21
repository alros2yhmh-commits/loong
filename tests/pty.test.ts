import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTerminalTool, killAllShells } from '../server/pty.ts'

const runId = 'pty-test'
const terminal = createTerminalTool(runId, true)

after(async () => {
  await killAllShells()
})

test('a real shell runs a command and returns its output', async () => {
  const out = await terminal.execute!(
    { action: 'run', command: 'echo hello-pty', waitMs: 1_200 },
    {} as never,
  )
  assert.match(String(out), /hello-pty/)
})

test('the shell stays alive between calls', async () => {
  const isWin = process.platform === 'win32'
  const set = isWin ? 'set LOONG_PTY=kept' : 'export LOONG_PTY=kept'
  const read = isWin ? 'echo %LOONG_PTY%' : 'echo $LOONG_PTY'
  await terminal.execute!({ action: 'run', command: set, waitMs: 900 }, {} as never)
  const out = await terminal.execute!({ action: 'run', command: read, waitMs: 900 }, {} as never)
  assert.match(String(out), /kept/)
})

test('kill closes the shell', async () => {
  const out = await terminal.execute!({ action: 'kill' }, {} as never)
  assert.match(String(out), /closed/i)
})

test('run without a command is refused, not guessed', async () => {
  const out = await terminal.execute!({ action: 'run' }, {} as never)
  assert.match(String(out), /needs a command/i)
})
