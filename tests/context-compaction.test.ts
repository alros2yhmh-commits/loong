/* Context compaction: the cap must not throw away the answer. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactHistory } from '../server/context.ts'
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
