/* Memory between conversations: the person, and what the last run concluded. */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  forgetProfileFact,
  learnAbout,
  profileBlock,
  readProfile,
  resetProfileForTests,
  setProfileName,
} from '../server/profile.ts'
import {
  digestBlock,
  listDigests,
  recentDigests,
  resetDigestsForTests,
  writeDigest,
} from '../server/digest.ts'
import { createSession } from '../server/db.ts'

beforeEach(() => {
  resetProfileForTests()
  resetDigestsForTests()
})

test('the profile keeps a name and de-duplicates the same fact', () => {
  setProfileName('Hamza')
  const one = learnAbout('Prefers Arabic and short answers.')
  const two = learnAbout('prefers arabic and short answers.')
  assert.equal(two.id, one.id)
  assert.equal(readProfile().facts.length, 1)
  const block = profileBlock()
  assert.match(block, /Hamza/)
  assert.match(block, /short answers/i)
})

test('a forgotten fact leaves the prompt', () => {
  const fact = learnAbout('Builds Loong on Windows.')
  assert.ok(forgetProfileFact(fact.id))
  assert.equal(forgetProfileFact(fact.id), false)
  assert.doesNotMatch(profileBlock(), /Builds Loong/)
})

test('a settled run leaves a digest for the next one', () => {
  const session = createSession({ title: 'fix the lexer', workspace: 'C:/work/loong' })
  const digest = writeDigest({
    sessionId: session.id,
    user: 'fix the lexer crash on CRLF',
    assistant:
      'Fixed it in src/lex.ts: the scanner compared a whole line instead of the terminator. The build passes now and the regression test covers CRLF and LF.',
  })
  assert.ok(digest)
  const block = digestBlock('C:/work/loong')
  assert.match(block, /RECENT WORK/)
  assert.match(block, /lex\.ts/)
  assert.equal(listDigests().length, 1)
})

test('an answer too short to mean anything is not a memory', () => {
  const session = createSession({ title: 'hi', workspace: 'C:/work/loong' })
  assert.equal(writeDigest({ sessionId: session.id, user: 'hi', assistant: 'Hello!' }), null)
  assert.equal(listDigests().length, 0)
})

test('recent_work finds the digests that mention the question', () => {
  const a = createSession({ title: 'lexer', workspace: 'C:/work/a' })
  const b = createSession({ title: 'deploy', workspace: 'C:/work/b' })
  writeDigest({
    sessionId: a.id,
    user: 'how does the tokenizer handle unicode',
    assistant: 'The tokenizer reads identifiers with \\p{L}; the unicode test passes and the file is src/tokenize.ts, covering emoji and Arabic identifiers.',
  })
  writeDigest({
    sessionId: b.id,
    user: 'publish the installer',
    assistant: 'The installer was built with electron-builder and signed with the local certificate; the artifact is in dist and the release notes are written.',
  })
  const hits = recentDigests('tokenizer unicode')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].sessionId, a.id)
})

test('one digest per session: the newest conclusion replaces the old one', () => {
  const session = createSession({ title: 'long job', workspace: 'C:/work/loong' })
  writeDigest({
    sessionId: session.id,
    user: 'first attempt',
    assistant:
      'The first attempt failed because the config path was wrong, and the failure was traced to the resolver reading the home directory instead of the project folder.',
  })
  writeDigest({
    sessionId: session.id,
    user: 'second attempt',
    assistant:
      'The second attempt fixed the resolver and shipped: the project folder is now authoritative and the session test passes with a saved workspace.',
  })
  const all = listDigests()
  assert.equal(all.length, 1)
  assert.match(all[0].gist, /second attempt/)
})
