import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findCheckRoot } from '../server/tools.ts'

const project = (root: string, name: string) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"vitest"}}', 'utf8')
  return dir
}

test('checks at the workspace root use the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-checks-'))
  writeFileSync(join(root, 'package.json'), '{"scripts":{"build":"vite build"}}', 'utf8')
  const found = findCheckRoot(root)
  assert.ok(!('error' in found))
  assert.equal(found.root, root)
})

test('one subproject is discovered instead of reported missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-checks-'))
  const sub = project(root, 'Loong-TaskLab-280')
  const found = findCheckRoot(root)
  assert.ok(!('error' in found))
  assert.equal(found.root, sub)
  assert.match(found.note ?? '', /Loong-TaskLab-280/)
})

test('several subprojects are reported by name, with the way out', () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-checks-'))
  project(root, 'app-one')
  project(root, 'app-two')
  const found = findCheckRoot(root)
  assert.ok('error' in found)
  assert.match(found.error, /app-one/)
  assert.match(found.error, /app-two/)
  assert.match(found.error, /path/)
})

test('an explicit path wins over discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-checks-'))
  const one = project(root, 'app-one')
  project(root, 'app-two')
  const found = findCheckRoot(root, 'app-one')
  assert.ok(!('error' in found))
  assert.equal(found.root, one)
})

test('an empty folder says there is nothing to check', () => {
  const root = mkdtempSync(join(tmpdir(), 'loong-checks-'))
  const found = findCheckRoot(root)
  assert.ok('error' in found)
  assert.match(found.error, /no recognisable checks/)
})
