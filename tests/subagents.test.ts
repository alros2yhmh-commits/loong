/* Subagents: a cold child, and a fork that inherits the conversation. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  childLoad,
  createTaskManyTool,
  createTaskTool,
  MAX_CHILDREN,
  MAX_TASKS_PER_CALL,
  resetChildLoadForTests,
  SUBAGENT_TOOLS,
  subagentSystemPrompt,
} from '../server/subagents.ts'

test('a fork is told it can read the conversation, and still cannot write', () => {
  const prompt = subagentSystemPrompt('fork', 'find the bug in the parser')
  assert.match(prompt, /conversation above/)
  assert.match(prompt, /Only READ|only READ/)
  assert.match(prompt, /find the bug in the parser/)
  assert.match(prompt, /trust the workspace/)
})

test('a cold child starts without the conversation', () => {
  const explore = subagentSystemPrompt('explore', 'map the repo')
  assert.doesNotMatch(explore, /conversation above/)
  assert.match(explore, /no memory of any conversation/)
})

test('the task tool accepts fork and rejects an unknown scope', () => {
  const taskTool = createTaskTool(async () => 'ok')
  /* the AI SDK types this as a union of schema kinds; at runtime it is zod */
  const schema = taskTool.inputSchema as unknown as { safeParse: (v: unknown) => { success: boolean } }
  assert.equal(schema.safeParse({ task: 'x', scope: 'fork' }).success, true)
  assert.equal(schema.safeParse({ task: 'x', scope: 'write' }).success, false)
})

test('every child tool is a read — no write, edit, shell or commit', () => {
  for (const forbidden of ['write_file', 'edit_file', 'apply_edits', 'shell', 'git_commit', 'propose_changes']) {
    assert.equal(
      (SUBAGENT_TOOLS as readonly string[]).includes(forbidden),
      false,
      `${forbidden} must never be handed to a child`,
    )
  }
  assert.ok((SUBAGENT_TOOLS as readonly string[]).includes('git_diff'), 'a child may read the diff')
})

test('task_many accepts thirty jobs and refuses thirty-one', () => {
  const many = createTaskManyTool(async () => 'ok')
  const schema = many.inputSchema as unknown as {
    safeParse: (v: unknown) => { success: boolean }
  }
  const jobs = (n: number) => ({ tasks: Array.from({ length: n }, (_, i) => ({ task: `job ${i}` })) })
  assert.equal(MAX_TASKS_PER_CALL, 30)
  assert.equal(schema.safeParse(jobs(30)).success, true)
  assert.equal(schema.safeParse(jobs(31)).success, false)
  assert.equal(schema.safeParse({ tasks: [] }).success, false)
})

test('the machine-wide cap holds when two fan-outs run together', async () => {
  resetChildLoadForTests()
  let active = 0
  let peak = 0
  const many = createTaskManyTool(async (req) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    active -= 1
    return `done: ${req.task}`
  }) as unknown as { execute: (args: unknown) => Promise<string> }
  const a = Array.from({ length: 30 }, (_, i) => ({ task: `a${i}` }))
  const b = Array.from({ length: 30 }, (_, i) => ({ task: `b${i}` }))
  const [first, second] = await Promise.all([
    many.execute({ tasks: a }),
    many.execute({ tasks: b }),
  ])
  assert.ok(peak <= MAX_CHILDREN, `peak concurrency ${peak} exceeded ${MAX_CHILDREN}`)
  assert.match(first, /\[30\/30 subagents/)
  assert.match(second, /\[30\/30 subagents/)
  assert.deepEqual(childLoad(), { active: 0, waiting: 0, cap: MAX_CHILDREN })
})

test('one failed batch task does not lose the other twenty-nine', async () => {
  resetChildLoadForTests()
  const many = createTaskManyTool(async (req) => {
    if (req.task === 'bad') throw new Error('provider refused')
    return `found something in ${req.task}`
  }) as unknown as { execute: (args: unknown) => Promise<string> }
  const report = await many.execute({
    tasks: [{ task: 'good one' }, { task: 'bad' }, { task: 'good two' }],
  })
  assert.match(report, /\[2\/3 subagents/)
  assert.match(report, /found something in good two/)
  assert.match(report, /failed/)
  assert.match(report, /provider refused/)
})
