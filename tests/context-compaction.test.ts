/* Context compaction: the cap must not throw away the answer. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactHistory, contextChars } from '../server/context.ts'
import type { HistoryTurn } from '../server/agent.ts'

const turn = (content: string, toolResults?: HistoryTurn['toolResults']): HistoryTurn => ({
  role: 'tool',
  content,
  toolResults,
})

test('a clipped tool result keeps its tail, not just its head', () => {
  /* the answer to a failing build is its LAST line, not its first */
  const output = `${'noise line\n'.repeat(900)}THE FINAL LINE IS THE ANSWER\n`
  const out = compactHistory([turn('ran the build', [{ toolCallId: '1', toolName: 'shell', output, ok: false }])])
  const clipped = out[0].toolResults![0].output
  assert.match(clipped, /THE FINAL LINE IS THE ANSWER/)
  assert.match(clipped, /chars omitted/)
  assert.ok(clipped.length < output.length, 'it must be shorter than the original')
})

test('a short result is untouched', () => {
  const original = 'ok'
  const out = compactHistory([turn('ran', [{ toolCallId: '1', toolName: 'shell', output: original, ok: true }])])
  assert.equal(out[0].toolResults![0].output, original)
})

test('a long history compacts to a bounded summary', () => {
  /* 60 turns of 800 chars each: the summary must not become a second
     context problem bigger than the history it replaced */
  const history: HistoryTurn[] = []
  for (let i = 0; i < 60; i++) {
    history.push({ role: 'user', content: `question ${i} ${'y'.repeat(800)}` })
    history.push({ role: 'assistant', content: `answer ${i} ${'z'.repeat(800)}` })
  }
  const out = compactHistory(history)
  assert.equal(out.length, 1 + 8, 'one summary + the 8 protected turns')
  assert.ok(out[0].content.length < 9_000, `summary was ${out[0].content.length} chars`)
  assert.match(out[0].content, /summarized to fit the context window/)
})

test('old tool results are cleared before the conversation is summarized', () => {
  /* ten 3 000-char results: past the first tier, under the summary budget.
     The newest six stay; the four oldest become a pointer, not an empty gap */
  const history: HistoryTurn[] = []
  for (let i = 0; i < 10; i++) {
    history.push({
      role: 'tool',
      content: `result ${i}`,
      toolResults: [{ toolCallId: String(i), toolName: 'read_file', output: `answer-${i}-${'x'.repeat(3_000)}`, ok: true }],
    })
  }
  const out = compactHistory(history)
  assert.equal(out.length, 10, 'clearing is not summarizing: the turns stay')
  assert.match(out[0].toolResults![0].output, /cleared to keep the context small/)
  assert.match(out[0].toolResults![0].output, /re-read the file/)
  assert.match(out[3].toolResults![0].output, /cleared/, 'the fourth-oldest goes too')
  assert.match(out[4].toolResults![0].output, /answer-4-/, 'the sixth-newest is kept verbatim')
  assert.match(out[9].toolResults![0].output, /answer-9-/, 'the newest is always kept')
})

test('at the context limit the recent turns and the early decision both survive', () => {
  /* the model's window is the thing that runs out. What must NOT run out:
     the user's original constraint, and the eight turns the run is standing on. */
  const history: HistoryTurn[] = [
    { role: 'user', content: 'CONSTRAINT: never touch the Flow folder. It is the audited original.' },
  ]
  for (let i = 0; i < 240; i++) {
    history.push({ role: 'assistant', content: `step ${i} ${'a'.repeat(400)}` })
    history.push({
      role: 'tool',
      content: `result ${i}`,
      toolResults: [
        {
          toolCallId: `c${i}`,
          toolName: 'read_file',
          output: `file ${i} says ${'b'.repeat(3_500)}`,
          ok: true,
        },
      ],
    })
  }
  for (let i = 0; i < 7; i++) {
    history.push({ role: 'user', content: `RECENT-QUESTION-${i}` })
    history.push({ role: 'assistant', content: `RECENT-ANSWER-${i}` })
  }

  const before = contextChars(history)
  const out = compactHistory(history)
  const after = contextChars(out)

  assert.ok(before > 800_000, `the fixture must really exhaust a window (was ${before})`)
  assert.ok(after < 60_000, `compaction left ${after} chars — the window would still be blown`)
  assert.ok(after < before / 10, 'compaction must actually shrink it')

  const text = out.map((t) => t.content).join('\n')
  assert.match(text, /CONSTRAINT: never touch the Flow folder/, 'the original constraint is the summary')
  assert.match(text, /summarized to fit the context window/)
  for (let i = 3; i < 7; i++) {
    assert.ok(text.includes(`RECENT-QUESTION-${i}`), `recent question ${i} was lost`)
    assert.ok(text.includes(`RECENT-ANSWER-${i}`), `recent answer ${i} was lost`)
  }
})

test('compacting an already compacted history does not grow it', () => {
  const history: HistoryTurn[] = []
  for (let i = 0; i < 120; i++) {
    history.push({ role: 'user', content: `q${i} ${'y'.repeat(500)}` })
    history.push({ role: 'assistant', content: `a${i} ${'z'.repeat(500)}` })
  }
  const once = compactHistory(history)
  const twice = compactHistory(once)
  assert.ok(contextChars(twice) <= contextChars(once) + 200, 'a second pass must not add work')
})
