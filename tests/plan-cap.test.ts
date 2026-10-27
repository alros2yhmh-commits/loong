import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlanTool, type Plan } from '../server/tools.ts'

const run = async (
  tool: ReturnType<typeof createPlanTool>,
  input: unknown,
): Promise<string> => {
  const execute = (tool as unknown as { execute: (i: unknown, o: unknown) => Promise<string> }).execute
  return execute(input, { toolCallId: 'plan-1', messages: [] })
}

const steps = (...descriptions: string[]) =>
  descriptions.map((description) => ({ description, status: 'pending' as const }))

/** the plan the tool last accepted — the input to its rewrite counter */
const held = () => {
  const box: { plan: Plan | null } = { plan: null }
  return { box, keep: (p: Plan) => { box.plan = p } }
}

test('a third rewrite of the plan is refused', async () => {
  const { box, keep } = held()
  const tool = createPlanTool(keep, { current: () => box.plan, maxRewrites: 2 })

  assert.match(await run(tool, { task: 't', steps: steps('a', 'b') }), /Plan saved with 2 step/)
  assert.match(await run(tool, { task: 't', steps: steps('c', 'd') }), /Plan saved with 2 step/)

  const refused = await run(tool, { task: 't', steps: steps('e', 'f') })
  assert.match(refused, /^Refused:/)
  assert.match(refused, /already set \(2 step\(s\)\)/)
  assert.match(refused, /write no more plans/i)
  assert.match(refused, /the next call must change a file/)

  /* the refusal must not replace the plan the run is working against */
  assert.deepEqual(box.plan?.steps.map((s) => s.description), ['c', 'd'])
})

test('a status update after the cap is allowed: same steps, new states', async () => {
  const { box, keep } = held()
  const tool = createPlanTool(keep, { current: () => box.plan, maxRewrites: 2 })
  await run(tool, { task: 't', steps: steps('a', 'b') })
  await run(tool, { task: 't', steps: steps('c', 'd') })
  await run(tool, { task: 't', steps: steps('e', 'f') })

  const update = await run(tool, {
    task: 't',
    steps: [
      { description: 'c', status: 'done' },
      { description: 'd', status: 'in_progress' },
    ],
  })
  assert.match(update, /Plan saved with 2 step/)
  assert.match(update, /1 done/)
  assert.deepEqual(box.plan?.steps.map((s) => s.status), ['done', 'in_progress'])
})

test('without a cap hint the default still allows the first two plans', async () => {
  const { box, keep } = held()
  const tool = createPlanTool(keep, { current: () => box.plan })
  assert.match(await run(tool, { task: 't', steps: steps('a') }), /Plan saved/)
  assert.match(await run(tool, { task: 't', steps: steps('b') }), /Plan saved/)
  assert.match(await run(tool, { task: 't', steps: steps('c') }), /^Refused:/)
})
