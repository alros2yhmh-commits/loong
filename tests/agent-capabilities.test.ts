/* The new capabilities: the clock, the timers, the library, the skills. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the clock, the timers, the library and a skill the agent writes itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loong-caps-'))
  process.env.LOONG_DATA_DIR = dir
  const ws = mkdtempSync(join(tmpdir(), 'loong-caps-ws-'))
  const { setWorkspace } = await import('../server/config.ts')
  setWorkspace(ws)

  /* ---- the clock ------------------------------------------------------ */
  const { nowBlock } = await import('../server/agent.ts')
  const clock = nowBlock(new Date('2026-10-23T09:00:00Z'))
  assert.match(clock, /NOW —/)
  assert.match(clock, /2026/)
  assert.match(clock, /Never guess the date/)

  /* ---- timers --------------------------------------------------------- */
  const { parseDelay, addTimer, fireDue, pendingTimers } = await import('../server/timers.ts')
  assert.equal(parseDelay('3m'), 180_000)
  assert.equal(parseDelay('90s'), 90_000)
  assert.equal(parseDelay('1h30m'), 5_400_000)
  assert.equal(parseDelay('soon'), null)

  const timer = addTimer({ afterMs: 60_000, prompt: 'check the build', title: 'build check' })
  assert.ok('id' in timer)
  /* not due yet */
  assert.equal(fireDue(Date.now()).length, 0)
  /* due */
  const fired = fireDue(Date.now() + 120_000)
  assert.equal(fired.length, 1)
  assert.ok(fired[0].sessionId, 'a thread is created for the prompt')
  assert.equal(pendingTimers().length, 1, 'the app still has to send it')

  /* ---- the library ---------------------------------------------------- */
  const { listTopics, readTopic, searchTopics, libraryIndexBlock } = await import('../server/library.ts')
  const topics = listTopics()
  assert.ok(topics.length >= 8, 'the seeded library has real depth')
  assert.ok(readTopic('git')?.body.includes('reflog'))
  assert.equal(searchTopics('reflog')[0]?.topic.id, 'git')
  assert.match(libraryIndexBlock(), /git:/)

  /* ---- a skill the agent writes for itself ---------------------------- */
  const { learnSkill, listSkills, skillIndexBlock, skillsBlock } = await import('../server/skills.ts')
  const saved = learnSkill({
    name: 'release checklist',
    description: 'how to ship this project',
    body: '1. npm test\n2. tag\n3. push',
    triggers: 'release, ship, tag',
  })
  assert.ok(saved.ok, saved.error)
  assert.ok(listSkills().some((s) => s.name === 'release checklist'))
  assert.match(skillIndexBlock(), /release checklist/)
  /* the body arrives only when the message matches — that is the point */
  assert.match(skillsBlock('time to release this'), /1\. npm test/)
  assert.equal(skillsBlock('paint the header blue'), '')
})

test('a thread closed mid-tool leaves a history the provider accepts', async () => {
  const { toModelMessages, INTERRUPTED_RESULT } = await import('../server/agent.ts')
  /* exactly what a closed thread looks like: the call was recorded, the result
     never came — the next run used to die with "Tool result is missing" */
  const history = [
    { role: 'user' as const, content: 'check the build' },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [
        { toolCallId: 'call_1', toolName: 'shell', input: { cmd: 'npm test' } },
        { toolCallId: 'call_2', toolName: 'read_file', input: { path: 'a.ts' } },
      ],
    },
    /* results arrive in their own tool turn — the shape the SDK expects */
    {
      role: 'tool' as const,
      content: '',
      toolResults: [{ toolCallId: 'call_1', toolName: 'shell', output: 'ok', ok: true }],
    },
  ]
  const messages = toModelMessages(history)
  const toolMessages = messages.filter((m) => m.role === 'tool')
  const ids = new Set<string>()
  for (const m of toolMessages) {
    for (const part of m.content as { toolCallId?: string }[]) {
      if (part.toolCallId) ids.add(part.toolCallId)
    }
  }
  assert.ok(ids.has('call_1'), 'the real result survives')
  assert.ok(ids.has('call_2'), 'the orphan is answered')
  const orphan = (toolMessages.at(-1)!.content as { output?: { value?: string } }[]).find(
    (p) => (p as { toolCallId?: string }).toolCallId === 'call_2',
  )
  assert.equal(orphan?.output?.value, INTERRUPTED_RESULT)
})
