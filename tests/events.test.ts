import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BaseEvent } from '@ag-ui/core'
import { EventEncoder } from '../server/events.ts'
import { parseFrames } from '../src/lib/stream.ts'

test('SSE JSON round-trips Unicode and embedded frame delimiters without injecting events', () => {
  const event = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'مرحبا\n\ndata: hostile\nline two' }
  const wire = new EventEncoder().encodeSSE(event as unknown as BaseEvent)
  const parsed = parseFrames(wire)
  assert.deepEqual(parsed.events, [event])
  assert.equal(parsed.rest, '')
})
