import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toModelMessages } from '../server/agent.ts'

/* ---------------------------------------------------------------------------
   Conversation history.

   This is the fix for the complaint that mattered most: the agent could not
   remember what it had just done. The cause was never the model — the runtime
   was throwing away every tool call and every tool result before sending the
   history back, so the model was handed a transcript of questions and answers
   with all of its own actions erased.

   These tests pin the provider's required shape: an assistant message carrying
   its tool calls, followed by a tool message carrying their results. Wrong
   order, or a tool call with no result, is a request the provider rejects.
   --------------------------------------------------------------------------- */

test('a turn with no tools is just prose', () => {
  const out = toModelMessages([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])
  assert.equal(out.length, 2)
  assert.equal(out[0].role, 'user')
  assert.equal(out[1].role, 'assistant')
  assert.deepEqual(out[1].content, [{ type: 'text', text: 'hi' }])
})

test('tool calls and results are both kept, in the order providers require', () => {
  const out = toModelMessages([
    { role: 'user', content: 'read package.json' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'read_file', input: { path: 'package.json' } },
      ],
    },
    {
      role: 'tool',
      content: '',
      toolResults: [
        {
          toolCallId: 'c1',
          toolName: 'read_file',
          output: '{ "name": "loong" }',
          ok: true,
        },
      ],
    },
    { role: 'assistant', content: 'The name is loong.' },
  ])

  assert.equal(out.length, 4)
  assert.equal(out[0].role, 'user')

  const assistant = out[1] as { role: string; content: unknown[] }
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content.length, 1, 'empty prose must not become a text part')
  assert.equal((assistant.content[0] as { type: string }).type, 'tool-call')
  assert.deepEqual((assistant.content[0] as { input: unknown }).input, {
    path: 'package.json',
  })

  const tool = out[2] as { role: string; content: unknown[] }
  assert.equal(tool.role, 'tool')
  assert.equal(tool.content.length, 1)
  assert.equal((tool.content[0] as { type: string }).type, 'tool-result')
  assert.equal((tool.content[0] as { isError?: boolean }).isError, false)

  assert.equal(out[3].role, 'assistant')
})

test('a failed tool result is marked as an error, not hidden', () => {
  const out = toModelMessages([
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolCallId: 'c1', toolName: 'shell', input: { command: 'x' } }],
    },
    {
      role: 'tool',
      content: '',
      toolResults: [
        { toolCallId: 'c1', toolName: 'shell', output: 'exit code 1', ok: false },
      ],
    },
  ])
  const tool = out[1] as { content: unknown[] }
  assert.equal((tool.content[0] as { isError?: boolean }).isError, true)
})

test('prose and tool calls in one turn stay in one assistant message', () => {
  const out = toModelMessages([
    {
      role: 'assistant',
      content: 'Reading both files now.',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'read_file', input: { path: 'a' } },
        { toolCallId: 'c2', toolName: 'read_file', input: { path: 'b' } },
      ],
    },
    {
      role: 'tool',
      content: '',
      toolResults: [
        { toolCallId: 'c1', toolName: 'read_file', output: 'A', ok: true },
        { toolCallId: 'c2', toolName: 'read_file', output: 'B', ok: true },
      ],
    },
  ])
  const assistant = out[0] as { content: unknown[] }
  assert.equal(assistant.content.length, 3)
  assert.equal((assistant.content[0] as { type: string }).type, 'text')
  assert.equal((assistant.content[1] as { type: string }).type, 'tool-call')
  assert.equal((assistant.content[2] as { type: string }).type, 'tool-call')
  /* both results ride in a single tool message — one per call, not two messages */
  assert.equal((out[1] as { content: unknown[] }).content.length, 2)
})

test('a tool call with no result yet is still sent as a call', () => {
  const out = toModelMessages([
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ toolCallId: 'c1', toolName: 'shell', input: { command: 'x' } }],
    },
  ])
  assert.equal(out.length, 1)
  const assistant = out[0] as { role: string; content: unknown[] }
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content.length, 1)
  assert.equal((assistant.content[0] as { type: string }).type, 'tool-call')
  /* no tool message: there is nothing to report, and an empty one is rejected */
})

test('an empty history produces an empty prompt', () => {
  assert.deepEqual(toModelMessages([]), [])
})

test('a tool message with no results produces nothing', () => {
  assert.deepEqual(toModelMessages([{ role: 'tool', content: '', toolResults: [] }]), [])
})
