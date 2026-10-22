/* A thread reopens with its run, not just its words. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('a thread snapshot round-trips the whole run', async () => {
  /* the store is isolated before the first import: DATA_DIR is read once, when
     config.ts loads, and the real one holds the user's own threads */
  const dir = mkdtempSync(join(tmpdir(), 'loong-threads-'))
  process.env.LOONG_DATA_DIR = dir
  const { saveBlocks, loadBlocks, deleteBlocks } = await import('../server/threads.ts')

  const blocks = [
    { k: 'user', id: 'u1', text: 'fix the build' },
    { k: 'tool', call: { id: 't1', name: 'shell', input: 'npm test' }, result: { ok: false, output: 'FAILED' } },
    { k: 'text', id: 'a1', text: 'fixed', live: false },
  ]
  saveBlocks('session-1', blocks)

  const back = loadBlocks('session-1')
  assert.deepEqual(back, blocks, 'the tools come back exactly as they were')

  /* a thread that was never snapshotted reads null, not an error */
  assert.equal(loadBlocks('session-missing'), null)

  /* a corrupt snapshot is moved aside, not fatal — the thread falls back to the
     conversation in the database instead of failing to open */
  const file = join(dir, 'threads', 'session-1.json')
  writeFileSync(file, '{not json', 'utf8')
  assert.equal(loadBlocks('session-1'), null)
  assert.ok(existsSync(`${file}.corrupt`), 'the broken file is kept for the reader to see')

  deleteBlocks('session-1')
  assert.equal(loadBlocks('session-1'), null)
})
