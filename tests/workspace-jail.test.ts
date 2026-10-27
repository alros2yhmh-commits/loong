import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  haveWorkspace,
  getWorkspace,
  setWorkspace,
  withRunWorkspace,
  resolveInside,
  WorkspaceViolation,
  ProtectedPath,
  NoWorkspace,
} from '../server/config.ts'
import { screenCommand } from '../server/command-guard.ts'

/* ---------------------------------------------------------------------------
   The boundary that failed.

   The packaged app started the agent with the user's home folder as the
   workspace. A weak model asked to "read the folder I opened" walked into
   `Desktop/.agent-collab/handoff.md` and the agent's own source, because all of
   it was technically "inside". These tests pin the three fixes:

     1. no folder means no file tools at all — not a fallback to cwd or home
     2. a chosen folder is a real boundary: `..`, absolute paths, junctions
     3. a run carries its own root, so two projects never share one boundary
     4. the shell is screened too — it takes commands, not paths
   --------------------------------------------------------------------------- */

const base = mkdtempSync(join(tmpdir(), 'loong-jail-'))
const root = join(base, 'project')
const outside = join(base, 'outside')
mkdirSync(root, { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(root, 'inside.txt'), 'safe')
writeFileSync(join(outside, 'secret.txt'), 'not yours')

process.on('exit', () => {
  try {
    rmSync(base, { recursive: true, force: true })
  } catch {
    /* windows keeps handles; the temp dir is disposable */
  }
})

/* first, before any test points the process at a folder */
test('with no folder chosen, every file tool refuses instead of falling back', { skip: haveWorkspace() }, () => {
  assert.equal(haveWorkspace(), false)
  assert.throws(() => resolveInside('anything.txt'), NoWorkspace)
  assert.throws(() => resolveInside('.'), NoWorkspace)
  assert.throws(() => resolveInside('C:\\Windows\\win.ini'), NoWorkspace)
})

test('a relative climb out of the folder is refused', () => {
  setWorkspace(root)
  assert.equal(getWorkspace(), root)
  assert.throws(() => resolveInside('../outside/secret.txt'), WorkspaceViolation)
  assert.throws(() => resolveInside('sub/../../outside/secret.txt'), WorkspaceViolation)
})

test('an absolute path outside the folder is refused, even on the same drive', () => {
  setWorkspace(root)
  assert.throws(() => resolveInside(join(outside, 'secret.txt')), WorkspaceViolation)
  if (process.platform === 'win32') {
    assert.throws(() => resolveInside('C:\\Windows\\win.ini'), WorkspaceViolation)
  }
})

test('a null byte is refused before the resolver ever normalises it', () => {
  setWorkspace(root)
  assert.throws(() => resolveInside('inside.txt\u0000.png'), WorkspaceViolation)
})

test('paths inside the folder still resolve, including files not written yet', () => {
  setWorkspace(root)
  assert.equal(resolveInside('inside.txt'), join(root, 'inside.txt'))
  assert.equal(resolveInside('new/dir/file.ts'), join(root, 'new', 'dir', 'file.ts'))
  assert.equal(resolveInside('.'), root)
})

test('a junction inside the folder cannot point the agent at the outside', () => {
  setWorkspace(root)
  const link = join(root, 'escape')
  try {
    symlinkSync(outside, link, 'junction')
  } catch {
    /* no privilege to create links on this machine — nothing to test */
    return
  }
  assert.throws(() => resolveInside('escape/secret.txt'), WorkspaceViolation)
  assert.throws(() => resolveInside('escape'), WorkspaceViolation)
})

test('protected folders are refused even when they sit inside the chosen folder', () => {
  /* the exact failure: home as the workspace exposed this file */
  const collab = join(root, '.agent-collab')
  mkdirSync(collab, { recursive: true })
  writeFileSync(join(collab, 'handoff.md'), '# secrets')
  setWorkspace(root)
  assert.throws(() => resolveInside('.agent-collab/handoff.md'), ProtectedPath)
  assert.throws(() => resolveInside(join(collab, 'handoff.md')), ProtectedPath)

  const ssh = join(root, '.ssh')
  mkdirSync(ssh, { recursive: true })
  writeFileSync(join(ssh, 'id_rsa'), 'key')
  assert.throws(() => resolveInside('.ssh/id_rsa'), ProtectedPath)
})

test('a run carries its own root and does not leak it to the process', async () => {
  setWorkspace(root)
  const other = join(base, 'other')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'a.txt'), 'a')

  await withRunWorkspace(other, async () => {
    assert.equal(getWorkspace(), other)
    assert.equal(resolveInside('a.txt'), join(other, 'a.txt'))
    assert.throws(() => resolveInside(join(root, 'inside.txt')), WorkspaceViolation)
  })

  assert.equal(getWorkspace(), root, 'the outer folder is unchanged')
  assert.equal(resolveInside('inside.txt'), join(root, 'inside.txt'))
})

test('two concurrent runs on two folders each keep their own boundary', async () => {
  setWorkspace(root)
  const a = join(base, 'a-project')
  const b = join(base, 'b-project')
  mkdirSync(a, { recursive: true })
  mkdirSync(b, { recursive: true })

  const run = (mine: string, theirs: string) =>
    withRunWorkspace(mine, async () => {
      await new Promise((r) => setTimeout(r, 5))
      assert.equal(getWorkspace(), mine)
      assert.throws(() => resolveInside(join(theirs, 'x')), WorkspaceViolation)
    })

  await Promise.all([run(a, b), run(b, a)])
})

test('the shell is screened: absolute paths, drive switches and climbs are refused', () => {
  setWorkspace(root)
  const verdict = (cmd: string) => screenCommand(cmd, root)

  assert.equal(verdict('dir').ok, true)
  assert.equal(verdict('git status').ok, true)
  assert.equal(verdict('npm test').ok, true)
  assert.equal(verdict('cd sub && cd ..').ok, true, 'a climb that lands on the root is fine')
  assert.equal(verdict(`cat "${join(root, 'inside.txt')}"`).ok, true, 'an absolute path inside is fine')

  if (process.platform === 'win32') {
    assert.equal(verdict('type C:\\Windows\\win.ini').ok, false)
    assert.equal(verdict('C: && dir').ok, false, 'a drive switch at the start of a segment')
    assert.equal(verdict('cd /d D:').ok, false, 'switching to another drive is outside the folder')
    assert.equal(verdict(`${join(outside, 'secret.txt')} & dir`).ok, false)
  }
  assert.equal(verdict('type ../../outside/secret.txt').ok, false)
  assert.equal(verdict('dir ..\\..').ok, false)
})

test('the shell refuses anything that names a protected folder or the home dir', () => {
  setWorkspace(root)
  const verdict = (cmd: string) => screenCommand(cmd, root)

  assert.equal(verdict('type .agent-collab/handoff.md').ok, false)
  assert.equal(verdict('type %USERPROFILE%\\Desktop\\.agent-collab\\handoff.md').ok, false)
  assert.equal(verdict('cat ~/.ssh/id_rsa').ok, false)
  assert.equal(verdict('type .loong/keys.json').ok, false)
  /* the false positive the old drive pattern caused: prose with a colon */
  assert.equal(verdict('echo note: ok').ok, true)
})

/* ---- the API contract ---------------------------------------------------- */

const dataDir = mkdtempSync(join(tmpdir(), 'loong-jail-api-'))
let baseUrl = ''
let proc: ChildProcess | null = null
let boot = ''

function start(): Promise<void> {
  if (baseUrl) return Promise.resolve()
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LOONG_PORT: '0',
        LOONG_DATA_DIR: dataDir,
        LOONG_WORKSPACE: '',
        NO_PROXY: '127.0.0.1,localhost',
      },
    })
    const timer = setTimeout(() => {
      reject(new Error(`the server did not announce a port in 30s:\n${boot}`))
    }, 30_000)
    const onData = (chunk: Buffer) => {
      boot += chunk.toString()
      const m = /agent server\s+http:\/\/[^:]+:(\d+)/.exec(boot)
      if (m) {
        clearTimeout(timer)
        baseUrl = `http://127.0.0.1:${m[1]}`
        resolve()
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', (c: Buffer) => {
      boot += c.toString()
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (!baseUrl) reject(new Error(`the server exited (${code}) before it was ready:\n${boot}`))
    })
  })
}

process.on('exit', () => {
  try {
    proc?.kill()
  } catch {
    /* already gone */
  }
})

/* the child's pipes would otherwise keep this process alive after the last test */
after(() => {
  try {
    proc?.kill()
  } catch {
    /* already gone */
  }
})

test('a fresh server reports no folder instead of inventing one', async () => {
  await start()
  const r = await fetch(`${baseUrl}/api/workspace`)
  assert.equal(r.status, 200)
  const body = (await r.json()) as { workspace: unknown }
  assert.equal(body.workspace, null, 'no folder is open — not cwd, not home')
})

test('a run without a folder is refused before any model call', async () => {
  await start()
  const r = await fetch(`${baseUrl}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'read the folder I opened' }],
      config: { provider: 'ollama', model: 'any-model' },
    }),
  })
  assert.equal(r.status, 400)
  const body = (await r.json()) as { error?: string }
  assert.match(String(body.error), /Choose a folder first/)
})
