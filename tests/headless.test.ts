import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHeadless, parseHeadlessArgs, workspacePatch, type HeadlessArgs } from '../server/headless.ts'
import type { runAgent } from '../server/agent.ts'

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'loong-headless-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  git('init', '-q')
  git('config', 'user.name', 'Loong Test')
  git('config', 'user.email', 'loong-test@example.invalid')
  writeFileSync(join(dir, 'tracked.txt'), 'baseline\n')
  git('add', 'tracked.txt')
  git('commit', '-qm', 'baseline')
  return { dir, git }
}

const argsFor = (workspace: string): HeadlessArgs => ({ task: 'Review the workspace.', workspace, provider: 'ollama', model: 'mock', steps: 17, timeout: 10, json: true })

test('patch captures final tracked, staged and new binary/text content without changing the Git index', async () => {
  const { dir, git } = repository()
  writeFileSync(join(dir, 'tracked.txt'), 'staged\n')
  git('add', 'tracked.txt')
  writeFileSync(join(dir, 'tracked.txt'), 'final working copy\n')
  mkdirSync(join(dir, 'new folder'))
  writeFileSync(join(dir, 'new folder', 'new file.txt'), 'new file\n')
  writeFileSync(join(dir, 'binary.dat'), Buffer.from([0, 1, 2, 250]))
  const index = readFileSync(join(dir, '.git', 'index'))
  const staged = git('diff', '--cached')
  const patch = await workspacePatch(dir)
  assert.deepEqual(readFileSync(join(dir, '.git', 'index')), index)
  assert.equal(git('diff', '--cached'), staged)
  assert.match(patch, /final working copy/)
  assert.match(patch, /new file/)
  assert.match(patch, /GIT binary patch/)
  const destination = mkdtempSync(join(tmpdir(), 'loong-headless-apply-'))
  execFileSync('git', ['clone', '-q', '--no-hardlinks', dir, destination])
  execFileSync('git', ['apply', '--binary', '-'], { cwd: destination, input: patch })
  assert.equal(readFileSync(join(destination, 'tracked.txt'), 'utf8'), 'final working copy\n')
  assert.equal(readFileSync(join(destination, 'new folder', 'new file.txt'), 'utf8'), 'new file\n')
  assert.deepEqual(readFileSync(join(destination, 'binary.dat')), Buffer.from([0, 1, 2, 250]))
})

test('patch captures an unborn repository without creating or changing an index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loong-headless-unborn-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'new.txt'), 'hello\n')
  const patch = await workspacePatch(dir)
  assert.match(patch, /new file mode/)
  assert.match(patch, /\+hello/)
  assert.equal(execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }), '')
})

test('headless outcome is truthful, counts failed tools, honors step budget and reports actual model', async () => {
  const { dir } = repository()
  const runner = (async (options) => {
    assert.equal(options.maxSteps, 17)
    assert.equal(options.route, 'manual')
    options.emit({ type: 'TOOL_CALL_START' } as never)
    options.emit({ type: 'TOOL_CALL_RESULT', isError: true } as never)
    options.emit({ type: 'RUN_FINISHED', result: { status: 'partial', reason: 'Tests remain open.', model: 'actual-model', promptTokens: 123, completionTokens: 17 } } as never)
  }) as typeof runAgent
  const result = await executeHeadless(argsFor(dir), runner)
  assert.equal(result.ok, false)
  assert.equal(result.status, 'partial')
  assert.equal(result.failedTools, 1)
  assert.equal(result.model, 'actual-model')
  assert.equal(result.requestedModel, 'mock')
  assert.equal(result.promptTokens, 123)
  assert.equal(result.completionTokens, 17)
})

test('a run without a terminal outcome is a failure, not a successful empty process', async () => {
  const { dir } = repository()
  const result = await executeHeadless(argsFor(dir), (async () => {}) as typeof runAgent)
  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.match(result.error ?? '', /without a terminal outcome/)
})

test('headless accepts a provider credential from the environment without including it in results', async () => {
  const { dir } = repository()
  const old = process.env.LOONG_PROVIDER_API_KEY
  process.env.LOONG_PROVIDER_API_KEY = 'test-only-not-a-real-secret'
  try {
    const runner = (async (options) => {
      assert.equal(options.config.apiKey, 'test-only-not-a-real-secret')
      options.emit({ type: 'RUN_FINISHED', result: { status: 'completed' } } as never)
    }) as typeof runAgent
    const result = await executeHeadless(argsFor(dir), runner)
    assert.equal(result.ok, true)
    assert.doesNotMatch(JSON.stringify(result), /test-only-not-a-real-secret/)
  } finally {
    if (old === undefined) delete process.env.LOONG_PROVIDER_API_KEY
    else process.env.LOONG_PROVIDER_API_KEY = old
  }
})

test('headless argument validation rejects missing models and invalid budgets', () => {
  assert.throws(() => parseHeadlessArgs(['--task', 'build', '--model', 'mock', '--steps', '-1']), /steps/)
  assert.throws(() => parseHeadlessArgs(['--task', 'build', '--model', 'mock', '--timeout', 'Infinity']), /timeout/)
  assert.throws(() => parseHeadlessArgs(['--task', 'build', '--model', 'mock', '--provider', 'typo']), /provider/)
  assert.equal(parseHeadlessArgs(['--task', 'build', '--model', 'mock', '--steps', '25']).steps, 25)
})
