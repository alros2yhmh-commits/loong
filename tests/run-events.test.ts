import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, type Block } from '../src/lib/blocks.ts'
import { parseFrames } from '../src/lib/stream.ts'

test('kernel content wire fields reach tool evidence, duplicate replay is harmless', () => {
  let blocks: Block[] = []
  blocks = fold(blocks, { type: 'TOOL_CALL_START', runId: 'r', sequence: 1, toolCallId: 'tool', toolCallName: 'shell' })
  blocks = fold(blocks, { type: 'TOOL_CALL_END', runId: 'r', sequence: 2, toolCallId: 'tool' })
  assert.equal(blocks[0].k === 'tool' && blocks[0].live, true)
  const result = { type: 'TOOL_CALL_RESULT', runId: 'r', sequence: 3, toolCallId: 'tool', content: 'Assertion failed', isError: true }
  blocks = fold(blocks, result)
  blocks = fold(blocks, result)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].k === 'tool' && blocks[0].result, 'Assertion failed')
  assert.equal(blocks[0].k === 'tool' && blocks[0].ok, false)
})

test('SSE frames tolerate CRLF/chunk boundaries and EOF is not a completion event', () => {
  const first = parseFrames('id: 1\r\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"a"}\r\n\r\ndata: {"type":')
  assert.equal(first.events.length, 1)
  const next = parseFrames(first.rest + '"RUN_FINISHED","result":{"status":"partial"}}\n\n')
  assert.equal(next.events[0].type, 'RUN_FINISHED')
  assert.equal(parseFrames('').events.length, 0)
  const blocks = fold([], { type: 'CUSTOM', name: 'loong.outcome', runId: 'r', value: { status: 'partial', reason: 'Open work remains.' } })
  assert.equal(blocks[0].k === 'outcome' && blocks[0].status, 'partial')
})
