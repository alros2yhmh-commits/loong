/* Headless execution keeps the user's Git index untouched. A result is successful
   only when the runtime reports completed; prose and process survival are not proof. */
import { execFile } from 'node:child_process'
import { lstatSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { runAgent } from './agent.ts'
import { getWorkspace, haveWorkspace, setWorkspace, withRunWorkspace } from './config.ts'
import { loadRuntimeKeys } from './providers.ts'
import { loadKeys } from './keys.ts'
import type { ProviderConfig, ProviderId } from './providers.ts'
import type { BaseEvent } from '@ag-ui/core'

const execFileAsync = promisify(execFile)
const PROVIDERS = new Set(['openrouter', 'ollama', 'anthropic', 'openai', 'google', 'custom'])
export type HeadlessStatus = 'completed' | 'partial' | 'blocked' | 'budget_exhausted' | 'cancelled' | 'failed'
const STATUSES = new Set<HeadlessStatus>(['completed', 'partial', 'blocked', 'budget_exhausted', 'cancelled', 'failed'])

export interface HeadlessArgs {
  task: string
  workspace?: string
  provider: ProviderId
  model: string
  key?: string
  baseUrl?: string
  steps: number
  timeout: number
  diff?: string
  json: boolean
}

function positiveNumber(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`--${name} must be an integer between 1 and ${max}.`)
  return number
}

export function parseHeadlessArgs(argv: string[]): HeadlessArgs {
  const allowed = new Set(['task', 'workspace', 'provider', 'model', 'key', 'base-url', 'steps', 'timeout', 'diff'])
  const values = new Map<string, string>()
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i]
    if (option === '--json') { json = true; continue }
    if (!option.startsWith('--') || !allowed.has(option.slice(2))) throw new Error(`Unknown option: ${option}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${option}.`)
    values.set(option.slice(2), value)
  }
  const task = values.get('task')?.trim()
  if (!task) throw new Error('Pass --task "your task" and --workspace /path/to/project. Use --json for machine-readable results.')
  const provider = values.get('provider') ?? 'openrouter'
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider}`)
  const model = values.get('model')?.trim() ?? process.env.LOONG_MODEL?.trim()
  if (!model) throw new Error('Pass --model or set LOONG_MODEL. Choose a currently available tool-capable model from your provider.')
  return {
    task, workspace: values.get('workspace'), provider: provider as ProviderId, model,
    key: values.get('key'), baseUrl: values.get('base-url'),
    steps: positiveNumber(values.get('steps') ?? process.env.LOONG_MAX_STEPS, 100, 'steps', 2000),
    timeout: positiveNumber(values.get('timeout'), 900, 'timeout', 86_400),
    diff: values.get('diff'), json,
  }
}

const GIT_OPTIONS = { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }

/** Capture tracked and new files without git add, resets, or temporary index writes.
 * The patch describes the entire dirty workspace relative to HEAD. Benchmarks
 * should begin in a clean disposable checkout, rather than a user's dirty tree. */
export async function workspacePatch(dir: string): Promise<string> {
  const git = (args: string[]) => execFileAsync('git', args, { ...GIT_OPTIONS, cwd: dir })
  await git(['rev-parse', '--show-toplevel'])
  const head = await git(['rev-parse', '--verify', 'HEAD']).then(() => true).catch(() => false)
  const tracked = head ? (await git(['diff', '--binary', '--no-ext-diff', '--no-color', 'HEAD', '--'])).stdout : ''
  const listed = await git(head
    ? ['ls-files', '--others', '--exclude-standard', '-z']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))]
  const additions: string[] = []
  for (const file of files) {
    try { lstatSync(resolve(dir, file)) } catch { continue }
    try {
      const { stdout } = await git(['diff', '--binary', '--no-ext-diff', '--no-color', '--no-index', '--', '/dev/null', file])
      additions.push(stdout)
    } catch (err) {
      const e = err as { code?: number; stdout?: string }
      if (e.code !== 1 || typeof e.stdout !== 'string') throw err
      additions.push(e.stdout)
    }
  }
  return tracked + additions.join('')
}

export interface HeadlessResult {
  ok: boolean
  status: HeadlessStatus
  reason: string | null
  workspace: string
  workspaceWasDirty: boolean | null
  provider: string
  model: string
  requestedModel: string
  steps: number
  budget: { used: number; budget: number } | null
  tools: number
  failedTools: number
  promptTokens: number | null
  completionTokens: number | null
  seconds: number
  text: string
  patchChars: number
  patchPath: string | null
  patchError: string | null
  error: string | null
}

function providerKey(provider: ProviderId): string | undefined {
  const names: Partial<Record<ProviderId, string>> = {
    openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', custom: 'CUSTOM_API_KEY',
  }
  return process.env.LOONG_PROVIDER_API_KEY?.trim() || (names[provider] ? process.env[names[provider]!]?.trim() : undefined)
}

/** Injectable runner permits testing CLI outcome handling without live credentials. */
export async function executeHeadless(a: HeadlessArgs, runner: typeof runAgent = runAgent): Promise<HeadlessResult> {
  if (a.workspace) setWorkspace(a.workspace)
  if (!haveWorkspace()) throw new Error('Choose an explicit workspace with --workspace before running the agent.')
  loadRuntimeKeys()
  loadKeys()
  const dir = getWorkspace()
  const config: ProviderConfig = {
    provider: a.provider, model: a.model,
    ...((a.key || providerKey(a.provider)) ? { apiKey: a.key || providerKey(a.provider) } : {}),
    ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
  }
  const dirty = await execFileAsync('git', ['status', '--porcelain'], { ...GIT_OPTIONS, cwd: dir })
    .then(({ stdout }) => Boolean(stdout)).catch(() => null)
  const runId = randomUUID()
  const started = Date.now()
  let text = '', actualModel = a.model
  let tools = 0, failed = 0, steps = 0
  const terminal: { status: HeadlessStatus | null; promptTokens: number | null; completionTokens: number | null } = { status: null, promptTokens: null, completionTokens: null }
  let reason: string | null = null, fatal: string | null = null
  let budget: { used: number; budget: number } | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), a.timeout * 1000)
  const outcome = (value: Record<string, unknown>) => {
    if (typeof value.status === 'string' && STATUSES.has(value.status as HeadlessStatus)) terminal.status = value.status as HeadlessStatus
    if (typeof value.reason === 'string') reason = value.reason
    if (typeof value.model === 'string') actualModel = value.model
    if (typeof value.promptTokens === 'number' && Number.isFinite(value.promptTokens)) terminal.promptTokens = value.promptTokens
    if (typeof value.completionTokens === 'number' && Number.isFinite(value.completionTokens)) terminal.completionTokens = value.completionTokens
  }
  try {
    await withRunWorkspace(dir, () => runner({
      runId, threadId: runId, messages: [{ role: 'user', content: a.task }], config,
      mode: 'agent', trust: 'auto', route: 'manual', maxSteps: a.steps,
      securityScan: true, abortSignal: controller.signal,
      emit: (event: BaseEvent) => {
        const e = event as unknown as { type: string; delta?: string; name?: string; value?: Record<string, unknown>; result?: Record<string, unknown>; message?: string; isError?: boolean }
        if (e.type === 'TEXT_MESSAGE_CONTENT' && typeof e.delta === 'string') text += e.delta
        if (e.type === 'TOOL_CALL_START') tools += 1
        if (e.type === 'TOOL_CALL_RESULT' && e.isError === true) failed += 1
        if (e.type === 'STEP_STARTED') steps += 1
        if (e.type === 'RUN_ERROR') fatal = e.message ?? 'The run failed.'
        if (e.type === 'RUN_FINISHED') outcome(e.result ?? {})
        if (e.name === 'loong.outcome') outcome(e.value ?? {})
        if (e.name === 'loong.stop') {
          const value = e.value ?? {}
          const reasons: Record<string, HeadlessStatus> = { 'stopped-short': 'partial', 'step-limit': 'budget_exhausted', aborted: 'cancelled' }
          if (typeof value.reason === 'string' && reasons[value.reason]) terminal.status = reasons[value.reason]
          if (typeof value.steps === 'number' && typeof value.budget === 'number') budget = { used: value.steps, budget: value.budget }
        }
      },
    }))
  } catch (err) {
    fatal = err instanceof Error ? err.message : String(err)
  } finally { clearTimeout(timer) }
  if (controller.signal.aborted) { terminal.status = 'cancelled'; reason = 'The run exceeded its timeout or was cancelled.' }
  else if (fatal) terminal.status = 'failed'
  else if (!terminal.status) { terminal.status = 'failed'; fatal = 'The runtime ended without a terminal outcome.' }
  let patch = '', patchError: string | null = null
  try { patch = await workspacePatch(dir) } catch (err) { patchError = err instanceof Error ? err.message : String(err) }
  if (a.diff) {
    if (patchError) { terminal.status = 'failed'; fatal = 'The requested patch could not be captured. See patchError.' }
    else {
      try { writeFileSync(a.diff, patch, 'utf8') } catch (err) { terminal.status = 'failed'; fatal = `Cannot write patch: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return {
    ok: terminal.status === 'completed' && fatal === null, status: terminal.status, reason, workspace: dir, workspaceWasDirty: dirty,
    provider: a.provider, model: actualModel, requestedModel: a.model, steps, budget, tools, failedTools: failed, promptTokens: terminal.promptTokens, completionTokens: terminal.completionTokens,
    seconds: Math.round((Date.now() - started) / 100) / 10, text: text.trim(),
    patchChars: patch.length, patchPath: a.diff ?? null, patchError, error: fatal,
  }
}

export async function main(argv: string[]): Promise<void> {
  try {
    const a = parseHeadlessArgs(argv)
    const result = await executeHeadless(a)
    process.stdout.write(a.json ? JSON.stringify(result) + '\n' : `${result.status} · ${result.steps} steps · ${result.tools} tools · ${result.seconds}s\n${result.text}\n${result.error ?? ''}\n`)
    process.exit(result.ok ? 0 : 1)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (argv.includes('--json')) process.stdout.write(JSON.stringify({ ok: false, status: 'failed', error: message }) + '\n')
    else process.stderr.write(message + '\n')
    process.exit(2)
  }
}
