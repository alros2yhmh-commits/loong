import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AguiBridge, toolTitle, type AguiEvent } from '../src/lib/agui.ts'

/* ---------------------------------------------------------------------------
   The bridge is the only piece of the interface that has to understand the wire
   protocol, so it is the piece worth testing hardest. Every test here is pure:
   an event goes in, interface events come out, no model and no socket.
   --------------------------------------------------------------------------- */

const ev = (type: string, rest: Record<string, unknown> = {}): AguiEvent => ({
  type,
  timestamp: 1000,
  ...rest,
})

test('RUN_STARTED opens a session', () => {
  const out = new AguiBridge().push(ev('RUN_STARTED', { threadId: 'th-1' }))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'session')
  assert.equal((out[0] as { id: string }).id, 'th-1')
})

test('text deltas become tokens, and END closes the message', () => {
  const b = new AguiBridge()
  assert.deepEqual(b.push(ev('TEXT_MESSAGE_START', { messageId: 'm1' })), [])
  const t1 = b.push(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Hel' }))
  const t2 = b.push(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'lo' }))
  assert.equal(t1[0].kind, 'token')
  assert.equal((t1[0] as { text: string }).text, 'Hel')
  assert.equal((t2[0] as { text: string }).text, 'lo')
  const end = b.push(ev('TEXT_MESSAGE_END', { messageId: 'm1' }))
  assert.equal(end[0].kind, 'message')
})

test('an empty text delta produces nothing rather than an empty token', () => {
  const b = new AguiBridge()
  assert.deepEqual(b.push(ev('TEXT_MESSAGE_CONTENT', { messageId: 'm', delta: '' })), [])
})

test('reasoning is accumulated and emitted once, at the end', () => {
  const b = new AguiBridge()
  assert.deepEqual(b.push(ev('REASONING_MESSAGE_START', { messageId: 'r1' })), [])
  assert.deepEqual(
    b.push(ev('REASONING_MESSAGE_CONTENT', { messageId: 'r1', delta: 'two ' })),
    [],
  )
  assert.deepEqual(
    b.push(ev('REASONING_MESSAGE_CONTENT', { messageId: 'r1', delta: 'candidates' })),
    [],
  )
  const out = b.push(ev('REASONING_MESSAGE_END', { messageId: 'r1' }))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'thinking')
  assert.equal((out[0] as { text: string }).text, 'two candidates')
})

test('whitespace-only reasoning is dropped, not shown as an empty block', () => {
  const b = new AguiBridge()
  b.push(ev('REASONING_MESSAGE_START', { messageId: 'r1' }))
  b.push(ev('REASONING_MESSAGE_CONTENT', { messageId: 'r1', delta: '   \n  ' }))
  assert.deepEqual(b.push(ev('REASONING_MESSAGE_END', { messageId: 'r1' })), [])
})

/* The card appears when the call starts, not when it ends. A shell command
   that runs for a minute should show something during that minute; it used to
   show nothing and then arrive finished. These two tests pin that. */
test('a tool call shows a card the instant it starts, before any arguments', () => {
  const b = new AguiBridge()
  const out = b.push(
    ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'read_file' }),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'tool_call')
  const call = (out[0] as { call: { id: string; tool: string; title: string; live: boolean; wire: string } }).call
  assert.equal(call.id, 'c1')
  assert.equal(call.tool, 'read_file')
  assert.equal(call.live, true, 'the card must know it is still running')
  assert.equal(call.wire, 'read_file', 'the card must know which tool really ran')
  assert.equal(call.title, 'read_file')
})

test('a tool call split across START, ARGS deltas and END becomes one card', () => {
  const b = new AguiBridge()
  b.push(ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'read_file' }))

  /* each ARGS delta is forwarded so the card can show arguments building up */
  const a = b.push(ev('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{"path":"sr' }))
  assert.equal(a.length, 1)
  assert.equal(a[0].kind, 'tool_args')
  assert.equal((a[0] as { delta: string }).delta, '{"path":"sr')

  b.push(ev('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: 'c/app.tsx"}' }))

  const out = b.push(ev('TOOL_CALL_END', { toolCallId: 'c1' }))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'tool_call')
  const call = (out[0] as { call: { id: string; tool: string; title: string; input: unknown; live: boolean } }).call
  assert.equal(call.id, 'c1')
  assert.equal(call.tool, 'read_file')
  assert.equal(call.title, 'src/app.tsx')
  assert.deepEqual(call.input, { path: 'src/app.tsx' })
  /* still live: the tool has not produced its result yet */
  assert.equal(call.live, true)
})

test('a result closes the card instead of adding a second one', () => {
  const b = new AguiBridge()
  b.push(ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'read_file' }))
  b.push(ev('TOOL_CALL_END', { toolCallId: 'c1' }))
  const out = b.push(
    ev('TOOL_CALL_RESULT', { toolCallId: 'c1', content: '1  hello' }),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'tool_result')
})

test('malformed tool arguments still produce a visible card', () => {
  const b = new AguiBridge()
  b.push(ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'shell' }))
  b.push(ev('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{not json' }))
  const out = b.push(ev('TOOL_CALL_END', { toolCallId: 'c1' }))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'tool_call')
  assert.ok('_raw' in ((out[0] as { call: { input: Record<string, unknown> } }).call.input))
})

test('unknown tool names are mapped onto an icon that exists', () => {
  const b = new AguiBridge()
  b.push(ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'some_future_tool' }))
  const out = b.push(ev('TOOL_CALL_END', { toolCallId: 'c1' }))
  const tool = (out[0] as { call: { tool: string } }).call.tool
  assert.ok(
    ['read_file', 'grep', 'shell', 'write_file', 'web_search'].includes(tool),
    `unexpected tool ${tool}`,
  )
})

test('a tool result is marked ok or failed from its content', () => {
  const b = new AguiBridge()
  const ok = b.push(
    ev('TOOL_CALL_RESULT', { toolCallId: 'c1', content: 'src/app.tsx  (lines 1-10 of 10)' }),
  )
  assert.equal((ok[0] as { result: { ok: boolean } }).result.ok, true)

  const bad = b.push(
    ev('TOOL_CALL_RESULT', { toolCallId: 'c2', content: 'Tool failed: ENOENT' }),
  )
  assert.equal((bad[0] as { result: { ok: boolean } }).result.ok, false)

  const refused = b.push(
    ev('TOOL_CALL_RESULT', { toolCallId: 'c3', content: 'Refused: outside the workspace.' }),
  )
  assert.equal((refused[0] as { result: { ok: boolean } }).result.ok, false)
})

test('an approval request becomes an approval block', () => {
  const b = new AguiBridge()
  const out = b.push(
    ev('CUSTOM', {
      name: 'loong.approval_requested',
      value: { id: 'a1', tool: 'write_file', title: 'src/x.ts', detail: 'Replace it.' },
    }),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'approval')
  const req = (out[0] as { request: { id: string; tool: string; title: string } }).request
  assert.equal(req.id, 'a1')
  assert.equal(req.tool, 'write_file')
  assert.equal(req.title, 'src/x.ts')
})

test('unrecognised CUSTOM events are ignored', () => {
  const b = new AguiBridge()
  assert.deepEqual(b.push(ev('CUSTOM', { name: 'something.else', value: {} })), [])
})

test('RUN_ERROR and RUN_FINISHED map to error and done', () => {
  const b = new AguiBridge()
  const err = b.push(ev('RUN_ERROR', { message: 'boom' }))
  assert.equal(err[0].kind, 'error')
  assert.equal((err[0] as { message: string }).message, 'boom')

  const fin = b.push(ev('RUN_FINISHED', { runId: 'r1' }))
  assert.equal(fin[0].kind, 'done')
})

test('a missing error message still produces a readable block', () => {
  const b = new AguiBridge()
  const out = b.push(ev('RUN_ERROR'))
  assert.equal((out[0] as { message: string }).message, 'The run failed.')
})

test('unknown event types never throw and never emit', () => {
  const b = new AguiBridge()
  for (const type of [
    'STEP_STARTED',
    'STATE_SNAPSHOT',
    'STATE_DELTA',
    'RAW',
    'ACTIVITY_SNAPSHOT',
    'SUBAGENT_STARTED',
    'SOMETHING_INVENTED_LATER',
  ]) {
    assert.deepEqual(b.push(ev(type)), [], `${type} should be ignored`)
  }
})

test('flush releases a tool call that never received its END', () => {
  const b = new AguiBridge()
  b.push(ev('TOOL_CALL_START', { toolCallId: 'c9', toolCallName: 'shell' }))
  const out = b.flush()
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'tool_call')
  assert.equal((out[0] as { call: { id: string } }).call.id, 'c9')
  /* and flushing twice does not duplicate it */
  assert.deepEqual(b.flush(), [])
})

test('toolTitle picks the useful field for each tool', () => {
  assert.equal(toolTitle('shell', { command: 'npm test' }), 'npm test')
  assert.equal(toolTitle('read_file', { path: 'a/b.ts' }), 'a/b.ts')
  assert.equal(toolTitle('list_dir', { path: '.' }), '.')
  assert.equal(toolTitle('grep', { pattern: 'useEdgeReveal' }), 'useEdgeReveal')
  assert.equal(toolTitle('fetch_url', { url: 'https://x.dev' }), 'https://x.dev')
  assert.equal(toolTitle('mystery', {}), 'mystery')
})
