import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { screenCommand } from '../server/command-guard.ts'

const root = process.platform === 'win32' ? 'C:\\projects\\example' : '/projects/example'

test('POSIX system executable paths work without allowing arbitrary data paths', { skip: process.platform === 'win32' }, () => {
  const executable = ['/usr/bin/python3', '/bin/sh', '/usr/bin/env'].find(existsSync)
  assert.ok(executable)
  assert.equal(screenCommand(`${executable} --version`, root).ok, true)
  assert.equal(screenCommand(`cd sub && "${executable}" --version`, root).ok, true)
  assert.equal(screenCommand(`env LOONG_TEST=1 ${executable} --version`, root).ok, true)
  assert.equal(screenCommand(`cat ${executable}`, root).ok, false, 'a system binary as data is not a command')
  assert.equal(screenCommand(`${executable} /etc/passwd`, root).ok, false)
  assert.equal(screenCommand('/tmp/untrusted-binary --version', root).ok, false)
})

test('POSIX null redirection is permitted but other absolute redirections are screened', { skip: process.platform === 'win32' }, () => {
  for (const command of ['npm test > /dev/null', 'npm test >/dev/null 2>&1', 'npm test 2>/dev/null']) {
    assert.equal(screenCommand(command, root).ok, true, command)
  }
  for (const command of ['npm test >/etc/passwd', 'cat </etc/passwd', 'npm test > /tmp/result.log']) {
    assert.equal(screenCommand(command, root).ok, false, command)
  }
})

test('system executables do not exempt protected paths, traversal or home references', () => {
  assert.equal(screenCommand('cat .ssh/id_rsa', root).ok, false)
  assert.equal(screenCommand('cat ../../outside.txt', root).ok, false)
  assert.equal(screenCommand('cat $HOME/.aws/credentials', root).ok, false)
})
