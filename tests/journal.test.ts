import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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


async function inWorkspace(name: string, fn: (workspace: string) => void | Promise<void>): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'loong-journal-operation-'))
  setWorkspace(workspace)
  setCurrentRun(name)
  try { await fn(workspace) } finally {
    setCurrentRun(null)
    rmSync(workspace, { recursive: true, force: true })
  }
}

test('real deletion saves binary and empty bytes before removing the files', async () => {
  const { deleteFileTool } = await import('../server/tools.ts')
  await inWorkspace('delete-bytes', async (ws) => {
    const binary = Buffer.from([0, 255, 128, 1, 10])
    writeFileSync(join(ws, 'binary.dat'), binary)
    writeFileSync(join(ws, 'empty.dat'), Buffer.alloc(0))
    await deleteFileTool.execute!({ path: 'binary.dat' }, {} as never)
    await deleteFileTool.execute!({ path: 'empty.dat' }, {} as never)
    assert.equal(existsSync(join(ws, 'binary.dat')), false)
    const result = rewindRun('delete-bytes')!
    assert.deepEqual(result.conflicts, [])
    assert.deepEqual(result.failed, [])
    assert.deepEqual(readFileSync(join(ws, 'binary.dat')), binary)
    assert.equal(readFileSync(join(ws, 'empty.dat')).length, 0)
  })
})

test('deleting a directory can restore nested files and empty directories', async () => {
  const { deleteFileTool } = await import('../server/tools.ts')
  await inWorkspace('delete-tree', async (ws) => {
    mkdirSync(join(ws, 'tree', 'empty'), { recursive: true })
    mkdirSync(join(ws, 'tree', 'nested'))
    writeFileSync(join(ws, 'tree', 'nested', 'a.txt'), 'important original')
    await deleteFileTool.execute!({ path: 'tree' }, {} as never)
    assert.equal(existsSync(join(ws, 'tree')), false)
    const result = rewindRun('delete-tree')!
    assert.deepEqual(result.failed, [])
    assert.deepEqual(result.conflicts, [])
    assert.equal(readFileSync(join(ws, 'tree', 'nested', 'a.txt'), 'utf8'), 'important original')
    assert.equal(existsSync(join(ws, 'tree', 'empty')), true)
  })
})

test('rewind preserves edits made by the user after a run', async () => {
  const { writeFileTool } = await import('../server/tools.ts')
  await inWorkspace('later-user-edit', async (ws) => {
    const file = join(ws, 'a.txt')
    writeFileSync(file, 'original')
    await writeFileTool.execute!({ path: 'a.txt', content: 'agent version' }, {} as never)
    writeFileSync(file, 'user work after agent')
    const result = rewindRun('later-user-edit')!
    assert.equal(result.conflicts.length, 1)
    assert.deepEqual(result.restored, [])
    assert.equal(readFileSync(file, 'utf8'), 'user work after agent')
  })
})

test('rewind reverses several writes to one file without false conflicts', async () => {
  const { writeFileTool } = await import('../server/tools.ts')
  await inWorkspace('several-writes', async (ws) => {
    const file = join(ws, 'a.txt')
    writeFileSync(file, 'original')
    await writeFileTool.execute!({ path: 'a.txt', content: 'first edit' }, {} as never)
    await writeFileTool.execute!({ path: 'a.txt', content: 'second edit' }, {} as never)
    const result = rewindRun('several-writes')!
    assert.deepEqual(result.conflicts, [])
    assert.deepEqual(result.failed, [])
    assert.equal(readFileSync(file, 'utf8'), 'original')
  })
})

test('a created directory holding a later user file is never recursively removed', async () => {
  const { mkdirTool } = await import('../server/tools.ts')
  await inWorkspace('later-directory-file', async (ws) => {
    await mkdirTool.execute!({ path: 'new-dir' }, {} as never)
    writeFileSync(join(ws, 'new-dir', 'user.txt'), 'preserve this')
    const result = rewindRun('later-directory-file')!
    assert.equal(result.conflicts.length, 1)
    assert.equal(readFileSync(join(ws, 'new-dir', 'user.txt'), 'utf8'), 'preserve this')
  })
})

test('moving over a file restores both source and overwritten destination on rewind', async () => {
  const { moveFileTool } = await import('../server/tools.ts')
  await inWorkspace('move-replacement', async (ws) => {
    writeFileSync(join(ws, 'source.txt'), 'source original')
    writeFileSync(join(ws, 'destination.txt'), 'destination original')
    await moveFileTool.execute!({ from: 'source.txt', to: 'destination.txt' }, {} as never)
    assert.equal(readFileSync(join(ws, 'destination.txt'), 'utf8'), 'source original')
    const result = rewindRun('move-replacement')!
    assert.deepEqual(result.failed, [])
    assert.deepEqual(result.conflicts, [])
    assert.equal(readFileSync(join(ws, 'source.txt'), 'utf8'), 'source original')
    assert.equal(readFileSync(join(ws, 'destination.txt'), 'utf8'), 'destination original')
  })
})

test('workspace root deletion and moving are refused before any change', async () => {
  const { deleteFileTool, moveFileTool } = await import('../server/tools.ts')
  await inWorkspace('protect-root', async (ws) => {
    writeFileSync(join(ws, 'a.txt'), 'still here')
    await assert.rejects(async () => deleteFileTool.execute!({ path: '.' }, {} as never), /workspace root/)
    await assert.rejects(async () => moveFileTool.execute!({ from: '.', to: 'nested' }, {} as never), /workspace root/)
    assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'still here')
  })
})

test('a symlink replacing the run file is preserved instead of following it on rewind', { skip: process.platform === 'win32' }, async () => {
  const { writeFileTool } = await import('../server/tools.ts')
  await inWorkspace('symlink-replacement', async (ws) => {
    const file = join(ws, 'a.txt')
    await writeFileTool.execute!({ path: 'a.txt', content: 'agent version' }, {} as never)
    writeFileSync(join(ws, 'other.txt'), 'agent version')
    rmSync(file)
    symlinkSync(join(ws, 'other.txt'), file)
    const result = rewindRun('symlink-replacement')!
    assert.equal(result.conflicts.length, 1)
    assert.equal(readFileSync(join(ws, 'other.txt'), 'utf8'), 'agent version')
    assert.equal(readFileSync(file, 'utf8'), 'agent version')
  })
})


test('rewind refuses an ancestor redirected to another file with identical contents', { skip: process.platform === 'win32' }, async () => {
  const { writeFileTool } = await import('../server/tools.ts')
  await inWorkspace('symlink-ancestor', async (ws) => {
    mkdirSync(join(ws, 'folder'))
    await writeFileTool.execute!({ path: 'folder/a.txt', content: 'agent version' }, {} as never)
    renameSync(join(ws, 'folder'), join(ws, 'original-folder'))
    mkdirSync(join(ws, 'user-folder'))
    writeFileSync(join(ws, 'user-folder', 'a.txt'), 'agent version')
    symlinkSync(join(ws, 'user-folder'), join(ws, 'folder'), 'dir')
    const result = rewindRun('symlink-ancestor')!
    assert.equal(result.conflicts.length, 1)
    assert.equal(readFileSync(join(ws, 'user-folder', 'a.txt'), 'utf8'), 'agent version')
    assert.equal(existsSync(join(ws, 'original-folder', 'a.txt')), true)
  })
})


test('write_file refuses to overwrite bytes it cannot snapshot', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { writeFileTool } = await import('../server/tools.ts')
  await inWorkspace('unreadable-before-state', async (ws) => {
    const file = join(ws, 'write-only.txt')
    writeFileSync(file, 'must survive')
    chmodSync(file, 0o200)
    try {
      await assert.rejects(async () => writeFileTool.execute!({ path: 'write-only.txt', content: 'replacement' }, {} as never), /EACCES|permission/i)
    } finally { chmodSync(file, 0o600) }
    assert.equal(readFileSync(file, 'utf8'), 'must survive')
  })
})
