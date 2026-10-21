import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   The write journal — how a run is undone.

   The journal writes into DATA_DIR, so this file points DATA_DIR at a
   throwaway folder BEFORE the module graph loads. node:test gives each test
   file its own process, so the real ~/.loong is never touched.
   --------------------------------------------------------------------------- */

const dataDir = mkdtempSync(join(tmpdir(), 'loong-journal-data-'))
process.env.LOONG_DATA_DIR = dataDir

const { setCurrentRun } = await import('../server/run-context.ts')
const { listCheckpoints, recordWrite, rewindLastRun, rewindRun } = await import(
  '../server/journal.ts'
)
const { setWorkspace } = await import('../server/config.ts')

after(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

test('a write is journalled and a rewind restores the previous content', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-journal-ws-'))
  /* the journal records absolute paths, and a rewind restores them only inside
     the workspace — so point the workspace at this temp folder for the test */
  setWorkspace(ws)
  try {
    const file = join(ws, 'a.txt')
    /* the file is already in its "after" state; the journal holds the before */
    writeFileSync(file, 'new content', 'utf8')

    setCurrentRun('run-write')
    recordWrite('write', file, 'old content')
    setCurrentRun(null)

    const checkpoints = listCheckpoints()
    const cp = checkpoints.find((c) => c.runId === 'run-write')
    assert.ok(cp, 'the run should have a checkpoint')
    assert.equal(cp!.files, 1)
    assert.equal(cp!.ops, 1)

    const result = rewindRun('run-write')
    assert.ok(result, 'rewind should return a result')
    assert.deepEqual(result!.restored, [file])
    assert.deepEqual(result!.removed, [])
    assert.equal(readFileSync(file, 'utf8'), 'old content')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a file the run created is removed on rewind', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-journal-ws-'))
  /* the journal records absolute paths, and a rewind restores them only inside
     the workspace — so point the workspace at this temp folder for the test */
  setWorkspace(ws)
  try {
    const file = join(ws, 'created.txt')
    writeFileSync(file, 'brand new', 'utf8')

    setCurrentRun('run-create')
    /* before === null means the path did not exist before the run */
    recordWrite('write', file, null)
    setCurrentRun(null)

    const result = rewindRun('run-create')
    assert.ok(result)
    assert.deepEqual(result!.removed, [file])
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('rewindLastRun undoes the most recent changing run', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-journal-ws-'))
  /* the journal records absolute paths, and a rewind restores them only inside
     the workspace — so point the workspace at this temp folder for the test */
  setWorkspace(ws)
  try {
    const older = join(ws, 'older.txt')
    const newer = join(ws, 'newer.txt')
    writeFileSync(older, 'older-after', 'utf8')
    writeFileSync(newer, 'newer-after', 'utf8')

    setCurrentRun('run-older')
    recordWrite('write', older, 'older-before')
    setCurrentRun(null)

    /* ensure the timestamps differ so "most recent" is unambiguous */
    const start = Date.now()
    while (Date.now() === start) {
      /* spin one tick */
    }

    setCurrentRun('run-newer')
    recordWrite('write', newer, 'newer-before')
    setCurrentRun(null)

    const result = rewindLastRun()
    assert.ok(result)
    assert.equal(result!.runId, 'run-newer')
    assert.equal(readFileSync(newer, 'utf8'), 'newer-before')
    /* the older run is untouched */
    assert.equal(readFileSync(older, 'utf8'), 'older-after')
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a tool outside a run journals nothing', () => {
  setCurrentRun(null)
  const before = listCheckpoints().length
  recordWrite('write', join(tmpdir(), 'loong-outside.txt'), 'x')
  assert.equal(listCheckpoints().length, before)
})

test('binary content is restored byte-for-byte on rewind', () => {
    const ws = mkdtempSync(join(tmpdir(), 'loong-journal-bin-'))
    setWorkspace(ws)
    try {
    const file = join(ws, 'img.bin')
    /* the file currently holds something else... */
    writeFileSync(file, 'text that should be replaced', 'utf8')
    /* ...and the journal holds a binary "before" — e.g. the file was a PNG */
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0xff, 0xfe, 0x00])

    setCurrentRun('run-bin')
    recordWrite('write', file, png)
    setCurrentRun(null)

    const result = rewindRun('run-bin')
    assert.ok(result)
    assert.deepEqual(result!.restored, [file])
    /* the bytes must survive the journal round-trip exactly, not be mangled by a
       UTF-8 re-encode */
    assert.deepEqual(readFileSync(file), png)
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
})
