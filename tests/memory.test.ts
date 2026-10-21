import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* the store lives in DATA_DIR; point it at a throwaway folder before load */
const dataDir = mkdtempSync(join(tmpdir(), 'loong-memory-data-'))
process.env.LOONG_DATA_DIR = dataDir

const { setWorkspace } = await import('../server/config.ts')
const { forget, listMemory, memoryBlock, recall, remember } = await import(
  '../server/memory.ts'
)

const wsA = mkdtempSync(join(tmpdir(), 'loong-memory-a-'))
const wsB = mkdtempSync(join(tmpdir(), 'loong-memory-b-'))

after(() => {
  for (const dir of [dataDir, wsA, wsB]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

test('a project fact is recalled in its own workspace', () => {
  setWorkspace(wsA)
  const entry = remember('The build uses pnpm, never npm.', 'project')
  assert.ok(entry.id)
  const hits = recall('pnpm')
  assert.ok(hits.some((h) => h.id === entry.id))
})

test('a project fact is invisible in another workspace', () => {
  setWorkspace(wsA)
  const entry = remember('This project deploys with fly.io.', 'project')
  setWorkspace(wsB)
  const hits = recall('fly.io')
  assert.equal(hits.some((h) => h.id === entry.id), false)
})

test('a global fact is visible everywhere', () => {
  setWorkspace(wsA)
  const entry = remember('The user prefers Arabic in conversation.', 'global')
  setWorkspace(wsB)
  const hits = recall('Arabic')
  assert.ok(hits.some((h) => h.id === entry.id))
})

test('identical text is refreshed, not duplicated', () => {
  setWorkspace(wsA)
  const a = remember('Tests run with node --test.', 'project')
  const b = remember('Tests run with node --test.', 'project')
  assert.equal(a.id, b.id)
  const matches = listMemory().filter((e) => e.text === 'Tests run with node --test.')
  assert.equal(matches.length, 1)
})

test('forget removes exactly one entry', () => {
  setWorkspace(wsA)
  const entry = remember('Delete me.', 'project')
  assert.equal(forget(entry.id), true)
  assert.equal(listMemory().some((e) => e.id === entry.id), false)
  assert.equal(forget(entry.id), false)
})

test('the prompt block carries this workspace and global entries, clipped', () => {
  setWorkspace(wsA)
  remember('A project rule for the prompt block.', 'project')
  remember('A global rule for the prompt block.', 'global')
  const block = memoryBlock()
  assert.match(block, /DURABLE MEMORY/)
  assert.match(block, /A project rule for the prompt block/)
  assert.match(block, /A global rule for the prompt block/)
  assert.ok(block.length < 4_000, 'the block must stay small')
})

test('an empty query returns the newest facts', () => {
  setWorkspace(wsA)
  const hits = recall('')
  assert.ok(hits.length > 0)
})
