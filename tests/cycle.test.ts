import test from 'node:test'
import assert from 'node:assert/strict'
import { createCycle, cyclePayload, missingEvidence, observe, phaseBlock, PHASES } from '../server/cycle.ts'

/** drive the machine with explicit timestamps so the order is the only variable */
function at(state: ReturnType<typeof createCycle>, ms: number) {
  return (tool: string, ok = true, input?: Record<string, unknown>) =>
    observe(state, { tool, ok, input }, ms)
}

test('a run starts in intake and a first look moves it to recon', () => {
  const c = createCycle(1000)
  assert.equal(c.phase, 'intake')
  const move = at(c, 1001)
  assert.equal(move('read_file'), 'recon')
  /* the same phase again is not a move */
  assert.equal(move('grep'), null)
})

test('three looks are enough to plan', () => {
  const c = createCycle(1000)
  const move = at(c, 1001)
  move('read_file')
  move('grep')
  assert.equal(move('project_overview'), 'plan')
  assert.ok(c.history.some((h) => h.phase === 'plan' && /enough to plan/.test(h.reason)))
})

test('a plan tool moves straight to plan, and the first write to act', () => {
  const c = createCycle(1000)
  const move = at(c, 1001)
  assert.equal(move('update_plan'), 'plan')
  assert.equal(move('edit_file'), 'act')
  assert.equal(c.writes, 1)
  assert.equal(c.lastWriteAt, 1001)
})

test('writing before looking is not allowed to pretend it planned', () => {
  const c = createCycle(1000)
  const move = at(c, 1001)
  assert.equal(move('write_file'), 'act')
  assert.match(c.history[c.history.length - 1].reason, /wrote before looking/)
})

test('a passing check after a write turns the claim into evidence', () => {
  const c = createCycle(1000)
  const move = at(c, 1000)
  move('read_file')
  move('update_plan')
  move('edit_file')
  assert.equal(missingEvidence(c), true)

  assert.equal(move('run_verification'), 'verify')
  assert.equal(missingEvidence(c), false)
  /* a second passing check closes the cycle in reflect */
  assert.equal(move('run_verification'), 'reflect')
})

test('a shell test/build command counts as a check', () => {
  const c = createCycle(1000)
  const move = at(c, 1000)
  move('read_file')
  move('update_plan')
  move('edit_file')
  assert.equal(move('shell', true, { command: 'npm test -- --runInBand' }), 'verify')
  assert.equal(missingEvidence(c), false)
})

test('a failed check in verify sends the run back to act', () => {
  const c = createCycle(1000)
  const move = at(c, 1000)
  move('read_file')
  move('update_plan')
  move('edit_file')
  move('run_verification') // act → verify
  assert.equal(move('run_verification', false), 'act')
  assert.equal(c.failures, 1)
})

test('a fresh write invalidates the earlier proof', () => {
  const c = createCycle(1000)
  const move = at(c, 1000)
  move('read_file')
  move('update_plan')
  move('edit_file')
  move('run_verification')
  assert.equal(missingEvidence(c), false)
  observe(c, { tool: 'edit_file', ok: true }, 2000)
  assert.equal(c.lastWriteAt, 2000)
  assert.equal(missingEvidence(c), true)
})

test('an interrupted run with no writes never trips the gate', () => {
  const c = createCycle(1000)
  observe(c, { tool: 'read_file', ok: true }, 1000)
  assert.equal(missingEvidence(c), false)
})

test('a refused write is never counted as an implementation', () => {
  const cycle = createCycle()
  observe(cycle, { tool: 'write_file', ok: false })
  assert.equal(cycle.writes, 0)
  assert.equal(missingEvidence(cycle), false)
})

test('a later failing check invalidates an earlier passing check', () => {
  const cycle = createCycle()
  observe(cycle, { tool: 'write_file', ok: true })
  observe(cycle, { tool: 'run_verification', ok: true })
  assert.equal(missingEvidence(cycle), false)
  observe(cycle, { tool: 'run_verification', ok: false })
  assert.equal(missingEvidence(cycle), true)
})

test('interactive terminal output alone does not prove a test command exited successfully', () => {
  const cycle = createCycle()
  observe(cycle, { tool: 'write_file', ok: true })
  observe(cycle, { tool: 'terminal', ok: true, input: { action: 'run', command: 'npm test' } })
  assert.equal(cycle.verifications, 0)
  assert.equal(missingEvidence(cycle), true)
})

test('the payload carries the phase list and live counts', () => {
  const c = createCycle(1000)
  observe(c, { tool: 'read_file', ok: true }, 1001)
  const p = cyclePayload(c, 'intake')
  assert.equal(p.phase, 'recon')
  assert.equal(p.from, 'intake')
  assert.equal(p.step, 1)
  assert.equal(p.reads, 1)
  assert.deepEqual(p.phases, PHASES)
})

test('a phase block with a plan asks for the change, not another plan', () => {
  const c = createCycle(1000)
  observe(c, { tool: 'update_plan', ok: true }, 1001)
  const empty = phaseBlock(c)
  assert.match(empty, /Write the steps with update_plan/)

  const withPlan = phaseBlock(c, { steps: 3, open: 2 })
  assert.match(withPlan, /Phase: plan/)
  assert.match(withPlan, /The plan is written \(3 step\(s\), 2 still open\)/)
  assert.match(withPlan, /Do not write another plan/)
  assert.match(withPlan, /write_file, edit_file or propose_changes/)
  assert.doesNotMatch(withPlan, /Write the steps with update_plan/)
})

test('the phase line carries the live step count, so a later step cannot read step 0', () => {
  const c = createCycle(1000)
  observe(c, { tool: 'read_file', ok: true }, 1001)
  observe(c, { tool: 'read_file', ok: true }, 1002)
  observe(c, { tool: 'read_file', ok: true }, 1003)
  const block = phaseBlock(c, { steps: 0, open: 0 })
  assert.match(block, /Phase: plan \(step 3 · 3 read\(s\)/)
})
