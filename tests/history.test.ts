/* Conversation search: the right project, the right snippet. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('a search finds the thread and names its project', async () => {
  /* an isolated store: the real DATA_DIR holds the user's own conversations,
     and a test that searches them is a test that lies */
  process.env.LOONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'loong-history-'))
  const { createSession, appendMessage, getMessages } = await import('../server/db.ts')
  const { setWorkspace } = await import('../server/config.ts')
  const { searchHistory } = await import('../server/history.ts')

  const dirA = mkdtempSync(join(tmpdir(), 'proj-a-'))
  const dirB = mkdtempSync(join(tmpdir(), 'proj-b-'))
  setWorkspace(dirA)

  const here = createSession({ title: 'the API redesign', workspace: dirA })
  appendMessage({ sessionId: here.id, role: 'user', content: 'we decided the endpoint is /v2/things' })
  const there = createSession({ title: 'unrelated notes', workspace: dirB })
  appendMessage({ sessionId: there.id, role: 'user', content: 'buy milk' })

  const hits = searchHistory('endpoint')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].sessionId, here.id)
  assert.equal(hits[0].currentProject, true)
  assert.match(hits[0].snippet, /\/v2\/things/)

  /* no query: this project's newest threads, never the world */
  const recent = searchHistory('')
  assert.ok(recent.length >= 1)
  assert.ok(recent.every((h) => h.currentProject))
  assert.ok(getMessages(here.id).length >= 1)
})
