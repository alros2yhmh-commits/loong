/* Desktop control validates before it runs, and servers refuse what they cannot do. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { psQuote, validateDesktop } from '../server/desktop.ts'
import {
  listServers,
  resetServersForTests,
  serverLogs,
  startServer,
  stopServer,
} from '../server/servers.ts'

test('a PowerShell value cannot break out of its quotes', () => {
  assert.equal(psQuote("it's"), "'it''s'")
  assert.equal(psQuote("a'; Remove-Item C:\\ -Recurse; '"), "'a''; Remove-Item C:\\ -Recurse; '''")
})

test('desktop refuses a target with a newline or nothing at all', () => {
  if (process.platform !== 'win32') return
  assert.match(String(validateDesktop({ action: 'open', target: '' })), /what to open/)
  assert.match(String(validateDesktop({ action: 'open', target: 'calc\nwhoami' })), /newline/)
})

test('a click needs whole-number screen coordinates inside a real screen', () => {
  if (process.platform !== 'win32') return
  assert.match(String(validateDesktop({ action: 'click' })), /whole-number/)
  assert.match(String(validateDesktop({ action: 'click', x: 1.5, y: 2 })), /whole-number/)
  assert.match(String(validateDesktop({ action: 'click', x: 99_999, y: 2 })), /outside/)
  assert.equal(validateDesktop({ action: 'click', x: 640, y: 480 }), null)
})

test('typing is bounded, and a key chord is a chord not a script', () => {
  if (process.platform !== 'win32') return
  assert.match(String(validateDesktop({ action: 'type', text: '' })), /no text/)
  assert.match(String(validateDesktop({ action: 'type', text: 'x'.repeat(2_001) })), /at most/)
  assert.match(String(validateDesktop({ action: 'key', keys: '; rm -rf' })), /SendKeys/)
  assert.equal(validateDesktop({ action: 'key', keys: '^s' }), null)
  assert.equal(validateDesktop({ action: 'key', keys: '%{F4}' }), null)
})

test('server_start refuses an empty command and a missing folder', () => {
  resetServersForTests()
  assert.match(startServer({ command: '   ' }).text, /needs a command/)
  const outside = startServer({ command: 'echo hi', cwd: 'C:/definitely/not/here' })
  assert.equal(outside.ok, false)
  assert.equal(listServers().length, 0)
})

test('an unknown server id is answered, not thrown', async () => {
  resetServersForTests()
  assert.equal(serverLogs('nope'), null)
  const stopped = await stopServer('nope')
  assert.equal(stopped.ok, false)
  assert.match(stopped.text, /server_list/)
})
