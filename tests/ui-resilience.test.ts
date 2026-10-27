/* The interface under a conversation that never ends, and the state under days
   of use. These are deterministic: no browser, no model, no clock. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRANSCRIPT_PAGE, TRANSCRIPT_TAIL, windowBlocks } from '../src/lib/window.ts'
import { DATA_DIR } from '../server/config.ts'
import { sendMessage, resetBusForTests } from '../server/bus.ts'
import { createSession } from '../server/db.ts'

test('a ten-thousand-block conversation renders a bounded tail', () => {
  const blocks = Array.from({ length: 10_000 }, (_, i) => ({ id: `b${i}` }))
  const first = windowBlocks(blocks)
  assert.equal(first.shown.length, TRANSCRIPT_TAIL)
  assert.equal(first.start, 10_000 - TRANSCRIPT_TAIL)
  assert.equal(first.shown[0].id, `b${first.start}`, 'the tail starts where the window says')
  assert.equal(first.shown.at(-1)!.id, 'b9999', 'the newest block is always shown')

  const expanded = windowBlocks(blocks, TRANSCRIPT_TAIL + TRANSCRIPT_PAGE * 3)
  assert.equal(expanded.shown.length, TRANSCRIPT_TAIL + TRANSCRIPT_PAGE * 3)
  assert.equal(expanded.hidden, 10_000 - expanded.shown.length)
})

test('a short conversation is not windowed at all', () => {
  const shown = windowBlocks([1, 2, 3])
  assert.deepEqual(shown.shown, [1, 2, 3])
  assert.equal(shown.hidden, 0)
})

test('the transcript never maps the full block list', async () => {
  /* the window is the contract: if the component maps p.blocks again, the DOM
     is unbounded no matter what window.ts says */
  const source = readFileSync(join(process.cwd(), 'src/components/Transcript.tsx'), 'utf8')
  assert.doesNotMatch(source, /\{p\.blocks\.map\(/)
  assert.match(source, /windowBlocks\(p\.blocks/)
})

test('the mailbox stays bounded after three days of chatter', () => {
  resetBusForTests()
  const a = createSession({ title: 'sender', workspace: 'C:/work/a' })
  const b = createSession({ title: 'receiver', workspace: 'C:/work/b' })
  /* 700 messages is more than a busy pair would send in days; the store caps
     at 600 and the READ path caps at 20, so neither the file nor the prompt
     grows without a ceiling */
  for (let i = 0; i < 700; i++) {
    sendMessage({ from: a.id, to: b.id, text: `message ${i} ${'x'.repeat(120)}` })
  }
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'agent-bus.json'), 'utf8')) as {
    messages: unknown[]
    seen: Record<string, number>
  }
  assert.ok(raw.messages.length <= 600, `the mailbox kept ${raw.messages.length} messages`)
  assert.equal(raw.messages.length, 600)
})
