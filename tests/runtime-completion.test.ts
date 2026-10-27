import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import type { BaseEvent } from '@ag-ui/core'
import { runAgent } from '../server/agent.ts'
import { withRunWorkspace } from '../server/config.ts'
import { runWithRunId } from '../server/run-context.ts'
import { readLedger } from '../server/ledger.ts'
import { compileBrief } from '../server/brief.ts'

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const finish = (reason = 'stop') => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage })
const say = (text: string) => [
  { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'reply' },
  { type: 'text-delta', id: 'reply', delta: text }, { type: 'text-end', id: 'reply' }, finish(),
]
const call = (name: string, input: unknown) => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: randomUUID(), toolName: name, input: JSON.stringify(input) },
  finish('tool-calls'),
]

type Event = BaseEvent & { name?: string; value?: Record<string, unknown>; result?: Record<string, unknown>; message?: string }

async function exercise(task: string, chunks: unknown[][], options: {
  files?: Record<string, string>; mode?: 'agent' | 'plan'; maxSteps?: number; securityScan?: boolean
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'loong-runtime-'))
  for (const [name, content] of Object.entries(options.files ?? {})) writeFileSync(join(root, name), content)
  const events: Event[] = []
  const prompts: string[] = []
  let cursor = 0
  const model = new MockLanguageModelV4({
    provider: 'mock', modelId: 'runtime-test',
    doStream: async (request) => {
      prompts.push(JSON.stringify(request.prompt))
      return { stream: simulateReadableStream({ chunks: chunks[Math.min(cursor++, chunks.length - 1)] as never[],
        initialDelayInMs: null, chunkDelayInMs: null }) }
    },
  })
  const runId = randomUUID()
  try {
    await withRunWorkspace(root, () => runWithRunId(runId, () => runAgent({
      runId, threadId: runId, messages: [{ role: 'user', content: task }],
      config: { provider: 'ollama', model: 'mock' }, model, mode: options.mode ?? 'agent',
      trust: 'auto', route: 'manual', maxSteps: options.maxSteps ?? 30,
      securityScan: options.securityScan,
      retryBackoffMs: [1, 1], emit: (event) => events.push(event as Event),
    })))
    return { root, events, prompts, ledger: readLedger(runId),
      outcome: events.find((event) => event.name === 'loong.outcome')?.value,
      cleanup: () => rmSync(root, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

test('an Arabic implementation request cannot complete after a read and a promise', async () => {
  const result = await exercise('اكتب برنامج كامل في calculator.js مع اختبارات ونفذ المهمة الآن', [
    call('read_file', { path: 'existing.txt' }), say('I reviewed it. I will implement the requested program next.'),
  ], { files: { 'existing.txt': 'Existing project.' } })
  try {
    assert.equal(result.outcome?.status, 'partial')
    assert.equal(result.ledger?.outcome, 'partial')
    assert.equal(result.ledger?.writes, 0)
    assert.ok(result.events.some((event) => event.name === 'loong.notice' && /completion gate/i.test(String(event.value?.text))))
  } finally { result.cleanup() }
})

test('propose_changes and update_plan advance the same live cycle as file tools', async () => {
  const result = await exercise('Create module.js and verify it.', [
    call('update_plan', { task: 'Create module', steps: [{ description: 'Create module', status: 'in_progress' }] }),
    call('propose_changes', { summary: 'Create the module', files: [{ path: 'module.js', content: 'export const answer = 42\n' }] }),
    say('Created the module.'),
  ])
  try {
    assert.equal(readFileSync(join(result.root, 'module.js'), 'utf8'), 'export const answer = 42\n')
    assert.match(result.prompts[1], /Phase: plan/)
    assert.match(result.prompts[2], /Phase: act/)
    assert.doesNotMatch(result.prompts[2], /Do not write anything yet/)
    assert.equal(result.ledger?.writes, 1)
    assert.equal(result.outcome?.status, 'partial', 'one file cannot complete an open plan')
  } finally { result.cleanup() }
})

test('failed verification is returned to the model before a partial terminal result', async () => {
  const result = await exercise('Create module.js and run its tests.', [
    call('write_file', { path: 'module.js', content: 'module.exports = 42\n' }), say('The implementation is complete.'),
  ], { files: { 'package.json': JSON.stringify({ scripts: { test: 'node check.cjs' } }),
    'check.cjs': 'console.error("EXPECTED_TEST_FAILURE"); process.exit(1)\n' } })
  try {
    assert.ok(result.prompts.some((prompt) => /EXPECTED_TEST_FAILURE/.test(prompt)))
    const failed = result.events.findIndex((event) => event.name === 'loong.checks' && event.value?.ok === false)
    const terminal = result.events.findIndex((event) => event.type === 'RUN_FINISHED')
    assert.ok(failed >= 0 && terminal > failed)
    assert.equal(result.outcome?.status, 'partial')
    assert.equal(result.ledger?.outcome, 'partial')
    assert.ok((result.ledger?.failures ?? 0) > 0)
  } finally { result.cleanup() }
})

test('the model can repair a real failing check and finish after a fresh passing check', async () => {
  const result = await exercise('Create module.js exporting the number 42 and verify its value.', [
    call('write_file', { path: 'module.js', content: 'module.exports = 0\n' }), say('Implemented.'),
    call('write_file', { path: 'module.js', content: 'module.exports = 42\n' }), say('Fixed the failing check.'),
  ], { files: { 'package.json': JSON.stringify({ scripts: { test: 'node check.cjs' } }),
    'check.cjs': 'require("node:assert/strict").equal(require("./module.js"),42)\n' } })
  try {
    const checks = result.events.filter((event) => event.name === 'loong.checks')
    assert.deepEqual(checks.map((event) => event.value?.ok), [false, true])
    assert.equal(result.outcome?.status, 'completed')
    assert.equal(readFileSync(join(result.root, 'module.js'), 'utf8'), 'module.exports = 42\n')
    assert.match(result.prompts[2], /FAILED/)
    assert.equal(result.events.filter((event) => event.type === 'RUN_FINISHED').length, 1)
  } finally { result.cleanup() }
})

test('a review of a bug is read-only and does not trigger the implementation gate', async () => {
  const result = await exercise('Review this bug and explain the cause; do not edit any files.', [
    call('read_file', { path: 'bug.js' }), say('The function returns the wrong value at line 1.'),
  ], { files: { 'bug.js': 'module.exports = 0\n' } })
  try {
    assert.equal(result.outcome?.status, 'completed')
    assert.equal(result.ledger?.writes, 0)
    assert.ok(!result.events.some((event) => event.name === 'loong.notice' && /completion gate/i.test(String(event.value?.text))))
  } finally { result.cleanup() }
})

test('blocked plan steps cannot be recorded as completed', async () => {
  const result = await exercise('Inspect the repository status.', [
    call('update_plan', { task: 'Inspect repo', steps: [{ description: 'Obtain required credential', status: 'blocked' }] }),
    say('I cannot continue without the credential.'),
  ])
  try {
    assert.equal(result.outcome?.status, 'blocked')
    assert.equal(result.ledger?.outcome, 'blocked')
  } finally { result.cleanup() }
})

test('an operational request cannot complete with only a promise to run a command', async () => {
  const result = await exercise('Run the project tests.', [say('I will run the tests next.')])
  try {
    assert.equal(result.outcome?.status, 'partial')
    assert.equal(result.ledger?.outcome, 'partial')
  } finally { result.cleanup() }
})

test('a small passing file cannot complete a substantial application request without scope evidence', async () => {
  const result = await exercise('اكتب تطبيق كامل لإدارة المهام مع تسجيل الدخول والتخزين والاختبارات', [
    call('write_file', { path: 'app.js', content: 'console.log("hello")\n' }), say('The application is complete.'),
  ], { files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }) } })
  try {
    assert.equal(result.outcome?.status, 'partial')
    assert.ok(result.prompts.some((prompt) => /task contract gate/.test(prompt)))
    assert.match(String(result.outcome?.reason), /scope|acceptance/)
  } finally { result.cleanup() }
})

test('an already-satisfied implementation can finish with inspected evidence and no forced write', async () => {
  const result = await exercise('Add an answer export with value 42 to module.js.', [
    call('read_file', { path: 'module.js' }),
    call('audit', { verdict: 'met', items: [{ criterion: 'answer export is 42', met: true,
      evidence: 'module.js line 1 already exports answer = 42; inspected with read_file.' }] }),
    say('module.js already exports answer = 42. No file change was required.'),
  ], { files: { 'module.js': 'export const answer = 42\n' } })
  try {
    assert.equal(result.outcome?.status, 'completed')
    assert.equal(result.ledger?.writes, 0)
  } finally { result.cleanup() }
})

test('critical security findings reach the model and precede the terminal outcome', async () => {
  const result = await exercise('Create key.txt with the specified fixture.', [
    call('write_file', { path: 'key.txt', content: '-----BEGIN PRIVATE KEY-----\nTEST FIXTURE ONLY\n' }),
    say('Created the requested fixture.'),
  ], { securityScan: true, files: { 'package.json': JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }) } })
  try {
    assert.equal(result.outcome?.status, 'partial')
    assert.ok(result.prompts.some((prompt) => /\[security check\]/.test(prompt)))
    const finding = result.events.findIndex((event) => event.name === 'loong.finding')
    const terminal = result.events.findIndex((event) => event.type === 'RUN_FINISHED')
    assert.ok(finding >= 0 && terminal > finding)
    assert.match(String(result.outcome?.reason), /security findings/)
  } finally { result.cleanup() }
})

test('Arabic intent keeps questions and reviews distinct from implementation and preserves all requirements', () => {
  assert.equal(compileBrief('لماذا يظهر خطأ في تسجيل الدخول؟').intent, 'explain')
  assert.equal(compileBrief('افحص مشكلة تسجيل الدخول بدون تعديل الملفات').intent, 'review')
  assert.equal(compileBrief('أصلح مشكلة تسجيل الدخول ونفذ الاختبارات').intent, 'fix')
  assert.equal(compileBrief('اكتب تقرير عن مشكلة تسجيل الدخول').intent, 'review')
  assert.equal(compileBrief('ابن تطبيق كامل لإدارة المهام').complexity, 'large')
  const request = `اكتب تطبيق ${'متطلب مهم '.repeat(100)}ويجب حفظ البيانات محليًا`
  assert.equal(compileBrief(request).objective, request)
})
