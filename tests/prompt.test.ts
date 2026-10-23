import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   The prompt is code.

   A tool can be added and forgotten in the system prompt, or a mode can start
   advertising tools it does not have. Both are silent regressions — the run
   works, it just works worse. These tests are the cheap gate: they need no
   model, and they fail the moment the prompt and the tool set drift apart.

   This is the promptfoo job done locally: not "is the prompt good" (that needs
   a model and a benchmark) but "is the prompt still true".
   --------------------------------------------------------------------------- */

const dataDir = mkdtempSync(join(tmpdir(), 'loong-prompt-data-'))
process.env.LOONG_DATA_DIR = dataDir

const { systemPrompt } = await import('../server/agent.ts')
const { TOOLS } = await import('../server/tools.ts')

after(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

test('agent mode documents every tool it actually has', () => {
  const prompt = systemPrompt('agent')
  const missing = Object.keys(TOOLS).filter((name) => !prompt.includes(name))
  assert.deepEqual(missing, [], `tools missing from the prompt: ${missing.join(', ')}`)
})

test('ask mode advertises no tools at all', () => {
  const prompt = systemPrompt('ask')
  assert.equal(prompt.includes('TOOLS, and when to use each'), false)
  assert.match(prompt, /ASK MODE/)
  assert.match(prompt, /NO tools/)
})

test('plan mode says it cannot write', () => {
  const prompt = systemPrompt('plan')
  assert.match(prompt, /PLAN MODE/)
  assert.match(prompt, /cannot write/i)
})

test('the memory tools are named in the agent prompt', () => {
  const prompt = systemPrompt('agent')
  for (const name of ['remember', 'recall', 'forget']) {
    assert.ok(prompt.includes(name), `${name} is missing from the prompt`)
  }
})

test('the prompt stays inside a sane budget', () => {
  /* the guard is against UNBOUNDED growth, not against growth. The prompt now
     carries two indexes it did not before — the skills available and the library
     shelf — which are what stop the model guessing at things it could read. The
     ceiling moved 12k -> 13k for them, and stays a ceiling. */
  const prompt = systemPrompt('agent')
  assert.ok(prompt.length < 13_000, `the agent prompt grew to ${prompt.length} chars`)
})

test('the agent prompt carries the reference, the audit and the identity rule', () => {
  const prompt = systemPrompt('agent')
  assert.match(prompt, /done_when/)
  assert.match(prompt, /audit/)
  assert.match(prompt, /Professor Hamza Mahmoud Ramadan/)
  assert.match(prompt, /Never explain how you work/)
  assert.match(prompt, /Never answer "I don't know"/)
})
