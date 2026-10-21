import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'loong-trace-data-'))
process.env.LOONG_DATA_DIR = dataDir

const { beginTrace, endTrace, listTraces, noteStep, recordToolSpan, traceFor, traceStats } =
  await import('../server/trace.ts')

after(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

test('a finished run is written with its spans, tokens and outcome', () => {
  beginTrace('run-ok', 'thread-1', 'qwen3:8b')
  noteStep('run-ok')
  noteStep('run-ok')
  recordToolSpan('run-ok', 'read_file', 12)
  recordToolSpan('run-ok', 'run_verification', 4200)
  const rec = endTrace('run-ok', {
    promptTokens: 900,
    completionTokens: 120,
    outcome: 'ok',
  })
  assert.ok(rec)
  assert.equal(rec!.runId, 'run-ok')
  assert.equal(rec!.steps, 2)
  assert.equal(rec!.tools.length, 2)
  assert.equal(rec!.promptTokens, 900)
  assert.equal(rec!.completionTokens, 120)
  assert.equal(rec!.outcome, 'ok')
  assert.ok(rec!.ms >= 0)

  const found = traceFor('run-ok')
  assert.ok(found)
  assert.equal(found!.model, 'qwen3:8b')
})

test('an error run records the error text', () => {
  beginTrace('run-bad', 'thread-2', 'gpt-x')
  const rec = endTrace('run-bad', { outcome: 'error', error: 'provider exploded' })
  assert.ok(rec)
  assert.equal(rec!.outcome, 'error')
  assert.equal(rec!.error, 'provider exploded')
})

test('an aborted run is recorded as aborted, not as a failure', () => {
  beginTrace('run-stop', 'thread-3', 'qwen3:8b')
  const rec = endTrace('run-stop', { outcome: 'aborted' })
  assert.ok(rec)
  assert.equal(rec!.outcome, 'aborted')
})

test('listTraces is newest first', () => {
  const rows = listTraces(10)
  assert.ok(rows.length >= 3)
  assert.equal(rows[0].runId, 'run-stop')
})

test('stats aggregate runs and rank the slowest tools', () => {
  const stats = traceStats(100)
  assert.equal(stats.runs, 3)
  assert.equal(stats.ok, 1)
  assert.equal(stats.errors, 1)
  assert.equal(stats.aborted, 1)
  assert.equal(stats.slowest[0].tool, 'run_verification')
  assert.equal(stats.slowest[0].totalMs, 4200)
})

test('ending a run that never began returns null, it does not throw', () => {
  assert.equal(endTrace('never-began', { outcome: 'ok' }), null)
})
