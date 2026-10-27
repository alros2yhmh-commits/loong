/* The agent bus: two sessions talking without the user relaying. */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  busBlock,
  formatPeers,
  readInbox,
  resetBusForTests,
  resolveRecipient,
  sendMessage,
  unreadCount,
} from '../server/bus.ts'
import { createSession } from '../server/db.ts'

beforeEach(() => resetBusForTests())

let n = 0

function pair() {
  n += 1
  const a = createSession({ title: `parser work ${n}`, workspace: 'C:/work/a' })
  const b = createSession({ title: `api redesign ${n}`, workspace: 'C:/work/b' })
  return { a, b, bTitle: `api redesign ${n}` }
}

test('a message waits in the inbox and reading marks it seen', () => {
  const { a, b } = pair()
  sendMessage({ from: a.id, to: b.id, text: 'does the parser handle CRLF?', kind: 'question' })
  assert.equal(unreadCount(b.id), 1)
  const first = readInbox(b.id)
  assert.equal(first.length, 1)
  assert.match(first[0].text, /CRLF/)
  assert.equal(first[0].kind, 'question')
  assert.equal(unreadCount(b.id), 0)
})

test('a broadcast reaches every other session and not the sender', () => {
  const { a, b } = pair()
  sendMessage({ from: a.id, to: 'all', text: 'the shared build is broken' })
  assert.equal(unreadCount(b.id), 1)
  assert.equal(unreadCount(a.id), 0)
})

test('a recipient resolves by exact title, and an unknown one says who exists', () => {
  const { a, b, bTitle } = pair()
  assert.equal(resolveRecipient(bTitle, a.id), b.id)
  assert.throws(() => resolveRecipient('nothing like this', a.id), /api redesign 3/)
})

test('a session cannot message itself', () => {
  const { a } = pair()
  assert.throws(() => sendMessage({ from: a.id, to: a.id, text: 'hello me' }), /itself/)
})

test('an unknown sender is refused instead of writing an orphan message', () => {
  const { b } = pair()
  assert.throws(() => sendMessage({ from: 'not-a-session', to: b.id, text: 'hi' }), /session id/)
})

test('the prompt block carries the messages once, then stops repeating them', () => {
  const { a, b } = pair()
  sendMessage({ from: a.id, to: b.id, text: 'handoff: the lexer is in src/lex.ts', kind: 'handoff' })
  const first = busBlock(b.id)
  assert.match(first, /AGENT MESSAGES/)
  assert.match(first, /src\/lex\.ts/)
  assert.match(first, /not from the user/)
  assert.equal(busBlock(b.id), '')
})

test('peers name the other sessions and their folders', () => {
  const { a } = pair()
  const text = formatPeers(a.id)
  assert.match(text, /api redesign/)
  assert.match(text, /work/)
})
