import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace, resolveInside } from '../server/config.ts'

/* ---------------------------------------------------------------------------
   The escape tests.

   An audit of this project found the workspace boundary checking the path it
   was handed, but not the path it pointed AT. A symlink inside the workspace
   that targets anywhere on the machine walked straight through. These tests
   are the gate: they must keep failing if that check is ever weakened.
   --------------------------------------------------------------------------- */

const originalWorkspace = process.cwd()

function freshWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'loong-sec-ws-'))
  setWorkspace(ws)
  return ws
}

test('a normal path inside the workspace still resolves', () => {
  const ws = freshWorkspace()
  try {
    writeFileSync(join(ws, 'ok.txt'), 'hello')
    assert.equal(resolveInside('ok.txt'), join(ws, 'ok.txt'))
    assert.equal(resolveInside('./nested/ok.txt'), join(ws, 'nested', 'ok.txt'))
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a path that escapes with .. is refused', () => {
  const ws = freshWorkspace()
  try {
    assert.throws(() => resolveInside('../outside.txt'), /outside the workspace/)
    assert.throws(() => resolveInside('a/../../b'), /outside the workspace/)
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a symlink pointing outside the workspace is refused', () => {
  const outside = mkdtempSync(join(tmpdir(), 'loong-sec-out-'))
  const ws = freshWorkspace()
  try {
    /* a junction is a directory symlink that needs no admin rights on Windows */
    symlinkSync(outside, join(ws, 'escape'), 'junction')
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    assert.throws(
      () => resolveInside('escape/secret.txt'),
      /outside the workspace/,
      'the link target is real: the check must follow it',
    )
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('a null byte is refused before it reaches the resolver', () => {
  freshWorkspace()
  try {
    assert.throws(() => resolveInside('a\u0000b'), /outside the workspace/)
  } finally {
    setWorkspace(originalWorkspace)
  }
})

test('a file that does not exist yet cannot escape by being created', () => {
  const outside = mkdtempSync(join(tmpdir(), 'loong-sec-out2-'))
  const ws = freshWorkspace()
  try {
    symlinkSync(outside, join(ws, 'escape'), 'junction')
    /* the file does not exist — the deepest existing ancestor is the junction,
       which itself resolves outside, so the write is refused */
    assert.throws(
      () => resolveInside('escape/brand/new.txt'),
      /outside the workspace/,
    )
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

/* ---- the local server's door --------------------------------------------- */

test('the local API refuses a request without the session token', async () => {
  process.env.LOONG_TOKEN = 'test-token-1234'
  /* the token is read at import time, so the import happens after it is set */
  const { app } = await import('../server/index.ts')
  const bare = await app.request('/api/health')
  assert.equal(bare.status, 401, 'no token, no answer')
  const withToken = await app.request('/api/health', {
    headers: { 'x-loong-token': 'test-token-1234' },
  })
  assert.equal(withToken.status, 200)
  const wrong = await app.request('/api/health', {
    headers: { 'x-loong-token': 'nope' },
  })
  assert.equal(wrong.status, 401)
  delete process.env.LOONG_TOKEN
})
