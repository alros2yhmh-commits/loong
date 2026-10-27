import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuditTool, type Audit } from '../server/tools.ts'

const run = async (
  tool: ReturnType<typeof createAuditTool>,
  input: unknown,
): Promise<string> => {
  const execute = (tool as unknown as { execute: (i: unknown, o: unknown) => Promise<string> }).execute
  return execute(input, { toolCallId: 'audit-1', messages: [] })
}

const item = (criterion: string, evidence = 'npm test — 9 passed') => ({ criterion, met: true, evidence })

/** a box, so TypeScript does not narrow the callback's assignment away */
const box = () => {
  const held: { audit: Audit | null } = { audit: null }
  return { held, take: (a: Audit) => { held.audit = a } }
}

test('"met" is refused while the plan still has open steps', async () => {
  const { held, take } = box()
  const tool = createAuditTool(take, () => ({ open: ['Add the board view'] }))
  const out = await run(tool, { verdict: 'met', items: [item('list view works')] })
  assert.match(out, /Audit rejected/)
  assert.match(out, /Add the board view/)
  assert.equal(held.audit?.verdict, 'partial', 'the rejection must be recorded honestly')
})

test('"met" is accepted when the plan has nothing open', async () => {
  const { held, take } = box()
  const tool = createAuditTool(take, () => ({ open: [] }))
  const out = await run(tool, { verdict: 'met', items: [item('list view works')] })
  assert.match(out, /You may say the job is done/)
  assert.equal(held.audit?.verdict, 'met')
})

test('a criterion without evidence is rejected even with no plan', async () => {
  const { held, take } = box()
  const tool = createAuditTool(take)
  const out = await run(tool, { verdict: 'met', items: [item('looks right', ' ')] })
  assert.match(out, /Audit rejected/)
  assert.match(out, /no real evidence/)
  assert.equal(held.audit?.verdict, 'partial')
})

test('an honest partial audit is recorded as written', async () => {
  const { held, take } = box()
  const tool = createAuditTool(take, () => ({ open: ['Add the board view'] }))
  const out = await run(tool, { verdict: 'partial', items: [item('list view works')] })
  assert.match(out, /not met/)
  assert.equal(held.audit?.verdict, 'partial')
})
