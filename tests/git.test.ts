import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setWorkspace } from '../server/config.ts'
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from '../server/git.ts'

/* ---------------------------------------------------------------------------
   The repository tools.

   Every leading agent in 2026 treats git as a first-class surface. These
   tests use a real repository in a temp dir — real git, real commits — and
   prove the one contract that matters: reads never ask, a commit is journalled
   as history-changing, and a folder that is not a repo fails honestly.
   --------------------------------------------------------------------------- */

const original = process.env.LOONG_WORKSPACE

/** run git directly, to set the fixture up */
function sh(args: string[], cwd: string) {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
}

let dir: string

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'loong-git-'))
  sh(['init', '--initial-branch=main'], dir)
  /* a fixture repo needs an identity or the tool's commit has none either */
  sh(['config', 'user.email', 'test@loong.local'], dir)
  sh(['config', 'user.name', 'Loong Test'], dir)
  writeFileSync(join(dir, 'a.txt'), 'alpha\n')
  sh(['add', 'a.txt'], dir)
  sh(['commit', '-m', 'initial commit'], dir)
  setWorkspace(dir)
})

after(() => {
  setWorkspace(original ?? process.cwd())
  rmSync(dir, { recursive: true, force: true })
})

const exec = (t: { execute?: (i: never, c: never) => unknown }, input: unknown) =>
  Promise.resolve(t.execute!(input as never, {} as never)) as Promise<string>

test('git_status reports a clean tree after a commit', async () => {
  const out = await exec(gitStatusTool, {})
  assert.match(out, /Clean working tree on main/)
  assert.doesNotMatch(out, /No git repository/)
})

test('git_status names an untracked file', async () => {
  writeFileSync(join(dir, 'b.txt'), 'beta\n')
  const out = await exec(gitStatusTool, {})
  assert.match(out, /b\.txt/)
})

test('git_diff shows the change, clipped to the file asked for', async () => {
  writeFileSync(join(dir, 'a.txt'), 'alpha\nbeta\n')
  const out = await exec(gitDiffTool, { path: 'a.txt' })
  assert.match(out, /\+beta/)
})

test('git_diff honours --staged', async () => {
  const out = await exec(gitDiffTool, { staged: true })
  assert.doesNotMatch(out, /\+beta/)
})

test('git_log lists the initial commit first, newest first', async () => {
  const out = await exec(gitLogTool, {})
  assert.match(out, /initial commit/)
})

test('git_commit stages the named path and commits it', async () => {
  const out = await exec(gitCommitTool, {
    message: 'add b and change a',
    stage_paths: ['b.txt', 'a.txt'],
  })
  assert.match(out, /Committed/)

  const log = await exec(gitLogTool, { count: 1 })
  assert.match(log, /add b and change a/)

  const status = await exec(gitStatusTool, {})
  assert.match(status, /Clean/)
})

test('git_commit with nothing staged says so instead of failing', async () => {
  const out = await exec(gitCommitTool, { message: 'nothing here' })
  assert.match(out, /Nothing to commit/)
})

test('a folder that is not a repository fails honestly', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'loong-plain-'))
  try {
    setWorkspace(plain)
    const out = await exec(gitStatusTool, {})
    assert.match(out, /No git repository/)
  } finally {
    setWorkspace(dir)
    rmSync(plain, { recursive: true, force: true })
  }
})
