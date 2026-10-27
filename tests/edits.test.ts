import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMatch, applyEdits, detectVerify } from '../server/edits.ts'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   The edit engine: one match applies, many refuse with line numbers, none
   refuses with a pointer to the closest line, and a whitespace-only
   difference still applies. The weak-model loop died on exactly these.
   --------------------------------------------------------------------------- */

test('a unique match applies', () => {
  const raw = 'one\ntwo\nthree\n'
  const m = findMatch(raw, 'two')
  assert.equal(m.kind, 'one')
  if (m.kind !== 'one') return
  const out = applyEdits(raw, [{ oldText: 'two', newText: 'TWO' }])
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(out.content, 'one\nTWO\nthree\n')
  assert.equal(out.applied, 1)
})

test('the same text twice refuses and names both lines', () => {
  const raw = 'a\nfoo\nb\nfoo\nc\n'
  const m = findMatch(raw, 'foo')
  assert.equal(m.kind, 'many')
  if (m.kind !== 'many') return
  assert.deepEqual(m.lines, [2, 4])
  const out = applyEdits(raw, [{ oldText: 'foo', newText: 'bar' }])
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.match(out.error, /appears 2 times \(lines 2, 4\)/)
})

test('missing text refuses with the closest line', () => {
  const raw = 'const a = 1\nconst bb = 2\n'
  const m = findMatch(raw, 'const b = 2')
  assert.equal(m.kind, 'none')
  if (m.kind !== 'none') return
  assert.match(m.hint, /closest line is 2/)
  assert.match(m.hint, /const bb = 2/)
})

test('CRLF and trailing whitespace still match, with a note', () => {
  const raw = 'one \r\ntwo\t\r\nthree\r\n'
  const out = applyEdits(raw, [{ oldText: 'one\ntwo\nthree', newText: 'X' }])
  assert.equal(out.ok, true)
  if (!out.ok) return
  /* the trailing newline was never part of the replaced text, so it stays */
  assert.equal(out.content, 'X\n')
  assert.match(out.notes[0], /trailing whitespace/)
})

test('a batch applies all-or-nothing', () => {
  const raw = 'alpha\nbeta\ngamma\n'
  const good = applyEdits(raw, [
    { oldText: 'alpha', newText: 'A' },
    { oldText: 'gamma', newText: 'G' },
  ])
  assert.equal(good.ok, true)
  if (!good.ok) return
  assert.equal(good.content, 'A\nbeta\nG\n')
  assert.equal(good.applied, 2)

  const bad = applyEdits(raw, [
    { oldText: 'alpha', newText: 'A' },
    { oldText: 'not-there', newText: 'G' },
  ])
  assert.equal(bad.ok, false)
  if (bad.ok) return
  assert.match(bad.error, /edit 2/)
})

test('overlapping edits in one batch are refused', () => {
  const raw = 'abcdef\n'
  const out = applyEdits(raw, [
    { oldText: 'abc', newText: 'x' },
    { oldText: 'bcd', newText: 'y' },
  ])
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.match(out.error, /overlap/)
})

test('batch edits use file offsets regardless of the order supplied', () => {
  const edits = [
    { oldText: 'BBB', newText: 'BBBBBBBB' },
    { oldText: 'DDD', newText: 'D' },
    { oldText: 'FFF', newText: '' },
  ]
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const result = applyEdits('aaa BBB ccc DDD eee FFF end', order.map((i) => edits[i]))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.content, 'aaa BBBBBBBB ccc D eee  end', `order ${order}`)
  }
})

test('a file that already ends without newline keeps that', () => {
  const raw = 'a\nb'
  const out = applyEdits(raw, [{ oldText: 'b', newText: 'B' }])
  assert.equal(out.ok, true)
  if (!out.ok) return
  assert.equal(out.content, 'a\nB')
})

/* -- verify-command detection -- */

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'loong-edits-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('package.json test script is detected first', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'vite build' } }))
    const v = detectVerify(dir)
    assert.deepEqual(v, { label: 'npm test', cmd: 'npm test --silent' })
  })
})

test('package.json falls back to build', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }))
    const v = detectVerify(dir)
    assert.deepEqual(v, { label: 'npm run build', cmd: 'npm run build' })
  })
})

test('gradlew with an app module assembles debug', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\n')
    mkdirSync(join(dir, 'app'))
    const v = detectVerify(dir)
    assert.deepEqual(v, { label: 'gradlew assembleDebug', cmd: 'gradlew assembleDebug' })
  })
})

test('a Makefile means make test', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'Makefile'), 'test:\n\techo hi\n')
    const v = detectVerify(dir)
    assert.deepEqual(v, { label: 'make test', cmd: 'make test' })
  })
})

test('nothing detectable means no check, not a wrong one', () => {
  withDir((dir) => {
    assert.equal(detectVerify(dir), null)
  })
})
