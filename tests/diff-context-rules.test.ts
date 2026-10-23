import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unifiedDiff } from '../server/diff.ts'
import { compactHistory } from '../server/context.ts'
import { readProjectRules, projectRulesBlock } from '../server/rules.ts'
import { skillsBlock, skillIndexBlock } from '../server/skills.ts'
import { setWorkspace } from '../server/config.ts'
import type { HistoryTurn } from '../server/agent.ts'

/* ---------------------------------------------------------------------------
   The three mechanisms that make long jobs survive.

   - diff.ts: an approval you cannot read is a coin flip. These pin the shape
     of the diff the user actually sees before authorising a write.
   - context.ts: a 30-turn job on a small context window dies mid-run. This
     pins the compaction contract — recent turns verbatim, old turns folded.
   - rules.ts: project rules are injected into the system prompt, never into
     the conversation, so the model cannot talk itself out of them.
   --------------------------------------------------------------------------- */

/* ---- diff ---------------------------------------------------------------- */

test('a diff marks added and removed lines and hunks', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng'
  const after = 'a\nb\nc\nD\ne\nf\ng'
  const lines = unifiedDiff(before, after).split('\n')
  assert.ok(lines.includes('-d'), `expected -d line in\n${lines.join('\n')}`)
  assert.ok(lines.includes('+D'), `expected +D line in\n${lines.join('\n')}`)
  assert.ok(lines.some((l) => l.startsWith('@@')), 'expected a hunk header')
  /* the change is shown with its context, not alone */
  assert.ok(lines.includes(' b'), 'expected context lines')
})

test('identical text produces an empty diff', () => {
  assert.equal(unifiedDiff('same\nlines', 'same\nlines'), '(no textual change)')
})

test('a pure addition has no removals', () => {
  const lines = unifiedDiff('one\ntwo', 'one\ntwo\nthree').split('\n')
  assert.ok(lines.includes('+three'))
  assert.ok(!lines.some((l) => l.startsWith('-')), 'no line should be removed')
})

test('crlf is normalised so a whole file does not show as changed', () => {
  const diff = unifiedDiff('a\r\nb\r\n', 'a\nb\n')
  assert.equal(diff, '(no textual change)')
})

test('a very large file falls back to a summary instead of a wall of hunk text', () => {
  const big1 = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')
  const big2 = `${big1}\nappended line`
  const diff = unifiedDiff(big1, big2)
  assert.match(diff, /too large to show inline/)
  assert.match(diff, /4000/)
})

/* ---- context compaction -------------------------------------------------- */

function turn(role: HistoryTurn['role'], content: string, tag = ''): HistoryTurn {
  const t: HistoryTurn = { role, content: `${tag}${content}` }
  if (role === 'assistant') t.toolCalls = []
  if (role === 'tool') t.toolResults = []
  return t
}

test('a short conversation is returned untouched', () => {
  const history = [turn('user', 'hi'), turn('assistant', 'hello')]
  assert.deepEqual(compactHistory(history), history)
})

test('a long conversation is folded to one summary plus the recent turns', () => {
  const filler = turn('user', 'x'.repeat(30_000))
  const history: HistoryTurn[] = [filler]
  for (let i = 0; i < 12; i++) {
    history.push(turn('user', `question ${i}`))
    history.push(turn('assistant', `answer ${i}`))
  }
  const out = compactHistory(history)
  /* one summary turn, then the 8 protected recent turns */
  assert.equal(out.length, 1 + 8)
  assert.equal(out[0].role, 'user')
  assert.match(out[0].content, /summarized to fit the context window/)
  /* the most recent question and answer survive verbatim */
  assert.equal(out[out.length - 2].content, 'question 11')
  assert.equal(out[out.length - 1].content, 'answer 11')
})

test('a conversation that fits the budget is not compacted even when long', () => {
  const history: HistoryTurn[] = []
  for (let i = 0; i < 30; i++) history.push(turn('user', `short ${i}`))
  assert.deepEqual(compactHistory(history), history)
})

test('the summary carries what was done, not how it was said', () => {
  const interesting: HistoryTurn[] = [
    turn('user', 'fix the build'),
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { toolCallId: 'c1', toolName: 'shell', input: { command: 'npm test' } },
      ],
    },
    {
      role: 'tool',
      content: '',
      toolResults: [
        { toolCallId: 'c1', toolName: 'shell', output: 'ok', ok: true },
      ],
    },
    turn('assistant', 'done'),
  ]
  /* a fat opening turn to blow the budget, then enough tail that the last
     eight turns are exercised as the verbatim window */
  const tail: HistoryTurn[] = []
  for (let i = 0; i < 10; i++) tail.push(turn('user', `later ${i}`))
  const many: HistoryTurn[] = [turn('user', 'x'.repeat(30_000)), ...interesting, ...tail]
  const out = compactHistory(many)
  const summary = out[0]
  assert.match(summary.content, /fix the build/)
  assert.match(summary.content, /shell/)
  assert.match(summary.content, /done/)
  /* the most recent turns survive word for word, in order */
  assert.equal(out.length, 1 + 8)
  assert.equal(out[out.length - 1].content, 'later 9')
})

/* ---- project rules ------------------------------------------------------- */

const originalWorkspace = process.cwd()

test('rules are read from LOONG.md at the workspace root', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-rules-'))
  try {
    writeFileSync(join(ws, 'LOONG.md'), '# Rules\n\nUse pnpm. Never commit on main.')
    setWorkspace(ws)
    const rules = readProjectRules()
    assert.match(rules ?? '', /Use pnpm/)
    assert.match(projectRulesBlock(), /PROJECT RULES/)
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})

test('a workspace with no LOONG.md injects nothing', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-norules-'))
  try {
    setWorkspace(ws)
    assert.equal(readProjectRules(), null)
    assert.equal(projectRulesBlock(), '')
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})

test('AGENTS.md is read alongside LOONG.md — the open standard', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-agents-'))
  try {
    writeFileSync(join(ws, 'LOONG.md'), 'Ours: pnpm only.')
    writeFileSync(join(ws, 'AGENTS.md'), 'The standard: run tests before committing.')
    setWorkspace(ws)
    const rules = readProjectRules() ?? ''
    assert.match(rules, /pnpm only/)
    assert.match(rules, /run tests before committing/)
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})

test('skills are read from the open Agent Skills layout and injected', () => {
  const ws = mkdtempSync(join(tmpdir(), 'loong-skills-'))
  try {
    const dir = join(ws, 'skills', 'release')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      ['---', 'name: release', 'description: how to ship', '---', '', '1. build', '2. tag'].join('\n'),
    )
    setWorkspace(ws)
    /* rules are rules; skills live in skills.ts now — the body arrives when the
       message matches the triggers, and the index always names it */
    const block = skillsBlock('how do I release this?')
    assert.match(block, /release/)
    assert.match(block, /1\. build/)
    assert.match(skillIndexBlock(), /release/)
    assert.doesNotMatch(projectRulesBlock(), /1\. build/)
  } finally {
    setWorkspace(originalWorkspace)
    rmSync(ws, { recursive: true, force: true })
  }
})
