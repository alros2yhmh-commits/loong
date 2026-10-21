import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  WorkspaceViolation,
  clip,
  displayPath,
  getWorkspace,
  resolveInside,
} from '../server/config.ts'

/* The boundary is no longer a frozen constant — it can be repointed at runtime.
   These are pure path tests, so snapshot the current root once and check
   against it. */
const WORKSPACE = getWorkspace()

/* ---------------------------------------------------------------------------
   The sandbox boundary.

   This is the security-critical part of the whole application. The model writes
   the path; the model is untrusted input. If `resolveInside` ever lets something
   through, an agent with a shell tool becomes an agent with the machine.
   --------------------------------------------------------------------------- */

test('a plain relative path resolves inside the workspace', () => {
  const abs = resolveInside('src/App.tsx')
  assert.equal(abs, resolve(WORKSPACE, 'src/App.tsx'))
  assert.ok(!relative(WORKSPACE, abs).startsWith('..'))
})

test('the workspace root itself is allowed', () => {
  assert.equal(resolveInside('.'), WORKSPACE)
})

test('escaping with .. is refused', () => {
  for (const bad of [
    '../secrets.txt',
    '../../etc/passwd',
    'src/../../outside.txt',
    './a/b/../../../c',
  ]) {
    assert.throws(() => resolveInside(bad), WorkspaceViolation, `should refuse ${bad}`)
  }
})

test('an absolute path outside the workspace is refused', () => {
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'
  assert.throws(() => resolveInside(outside), WorkspaceViolation)
})

test('an absolute path inside the workspace is allowed', () => {
  const inside = resolve(WORKSPACE, 'package.json')
  assert.equal(resolveInside(inside), inside)
})

test('a sibling directory that merely shares a prefix is refused', () => {
  /* the classic off-by-one: /work-evil must not pass a check against /work */
  const sibling = `${WORKSPACE}-evil/secret.txt`
  assert.throws(() => resolveInside(sibling), WorkspaceViolation)
})

test('a null byte in the path is refused outright', () => {
  /* path.resolve would normalise this away as a harmless segment, but the
     syscall underneath truncates at the null, so the checked path and the
     opened path would not be the same path */
  assert.throws(() => resolveInside('src/\u0000/../../etc'), WorkspaceViolation)
  assert.throws(() => resolveInside('src\u0000/../../../etc'), WorkspaceViolation)
  assert.throws(() => resolveInside('file.txt\u0000'), WorkspaceViolation)
})

test('a null byte cannot be used to hide a traversal', () => {
  /* without the explicit check this normalises to the grandparent, and whether
     it is caught would depend on how many ../ the caller happened to write */
  const sneaky = `src\u0000/${'../'.repeat(4)}etc`
  assert.throws(() => resolveInside(sneaky), WorkspaceViolation)
})

test('displayPath never leaks the absolute machine path', () => {
  const shown = displayPath(resolve(WORKSPACE, 'src/App.tsx'))
  assert.equal(shown, 'src/App.tsx')
  assert.ok(!isAbsolute(shown))
  assert.ok(!shown.includes(WORKSPACE))
})

test('displayPath uses forward slashes on every platform', () => {
  const shown = displayPath(resolve(WORKSPACE, 'a/b/c.ts'))
  assert.equal(shown, 'a/b/c.ts')
  assert.ok(!shown.includes('\\'))
})

test('clip leaves short text exactly as it was', () => {
  const short = 'hello'
  assert.equal(clip(short, 100), short)
})

test('clip truncates and says how much was dropped', () => {
  const long = 'x'.repeat(500)
  const out = clip(long, 100)
  assert.ok(out.startsWith('x'.repeat(100)))
  assert.ok(out.includes('400'))
  assert.ok(out.includes('truncated'))
})

test('clip is applied at the boundary, not one character late', () => {
  assert.equal(clip('abcde', 5), 'abcde')
  assert.ok(clip('abcdef', 5).includes('truncated'))
})
