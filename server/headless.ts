/* ---------------------------------------------------------------------------
   Headless run — one task, one process, a machine-readable result.

   Every agent benchmark (SWE-bench, Terminal-Bench, GAIA, τ²-bench) needs the
   same three things a GUI never asks for:

     1. a run that starts and ends without a human (trust=auto, no TTY),
     2. a bounded step budget that is the caller's choice, not a constant,
     3. the result as data — the final text, the tool ledger, and the diff.

   Usage:
     loong-agent run --task "<prompt>" [--workspace dir] [--provider openrouter]
                     [--model id] [--key k] [--steps 150] [--timeout 900]
                     [--diff out.patch] [--json]

   Exit code 0 when the run completed without a fatal error, 1 otherwise.
   The JSON goes to stdout; anything else (logs) goes to stderr, so a harness
   can parse stdout without guessing.
   --------------------------------------------------------------------------- */

import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { runAgent } from './agent.ts'
import { getWorkspace, setWorkspace } from './config.ts'
import { loadRuntimeKeys } from './providers.ts'
import type { ProviderConfig, ProviderId } from './providers.ts'
import type { BaseEvent } from '@ag-ui/core'

const execFileAsync = promisify(execFile)

interface Args {
  task: string
  workspace?: string
  provider: ProviderId
  model: string
  key?: string
  /** an OpenAI-compatible local server (LM Studio, llama.cpp, vLLM) */
  baseUrl?: string
  steps: number
  timeout: number
  diff?: string
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const task = get('task')
  if (!task) {
    process.stderr.write(
      'usage: loong-agent run --task "<prompt>" [--workspace dir] [--provider openrouter] [--model id] [--key k] [--base-url url] [--steps 150] [--timeout 900] [--diff out.patch] [--json]\n',
    )
    process.exit(2)
  }
  return {
    task,
    workspace: get('workspace'),
    provider: (get('provider') as ProviderId) ?? 'openrouter',
    model: get('model') ?? 'cohere/north-mini-code:free',
    key: get('key'),
    baseUrl: get('base-url'),
    steps: Number(get('steps') ?? process.env.LOONG_MAX_STEPS ?? 40),
    timeout: Number(get('timeout') ?? 900),
    diff: get('diff'),
    json: argv.includes('--json'),
  }
}

/** the final diff of a workspace, as a patch a harness can apply.
 *  `git diff` alone is blind to NEW files (untracked), and a benchmark task
 *  usually creates one — so the working tree is staged first and the staged
 *  diff is read. The index is the harness's, not the user's: a headless run
 *  owns its workspace. */
async function workspacePatch(dir: string): Promise<string> {
  try {
    await execFileAsync('git', ['add', '-A'], {
      cwd: dir,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    const { stdout } = await execFileAsync('git', ['diff', '--cached', '--no-color'], {
      cwd: dir,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout
  } catch {
    return ''
  }
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv)
  if (a.workspace) setWorkspace(a.workspace)
  loadRuntimeKeys()

  const dir = getWorkspace()
  const config: ProviderConfig = {
    provider: a.provider,
    model: a.model,
    ...(a.key ? { apiKey: a.key } : {}),
    ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
  }

  const runId = randomUUID()
  const threadId = randomUUID()
  const started = Date.now()

  /* the ledger a harness reads instead of a UI */
  let text = ''
  let tools = 0
  let failed = 0
  let steps = 0
  let stopReason = 'completed'
  let fatal: string | null = null
  let budget: { used: number; budget: number } | null = null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(10, a.timeout) * 1000)

  await runAgent({
    runId,
    threadId,
    messages: [{ role: 'user', content: a.task }],
    config,
    mode: 'agent',
    trust: 'auto',
    securityScan: false,
    abortSignal: controller.signal,
    emit: (event: BaseEvent) => {
      const e = event as unknown as {
        type: string
        delta?: string
        name?: string
        value?: Record<string, unknown>
        message?: string
      }
      if (e.type === 'TEXT_MESSAGE_CONTENT' && typeof e.delta === 'string') text += e.delta
      if (e.type === 'TOOL_CALL_START') tools += 1
      if (e.type === 'TOOL_CALL_RESULT' && (e as { ok?: boolean }).ok === false) failed += 1
      if (e.type === 'STEP_STARTED') steps += 1
      if (e.type === 'RUN_ERROR') fatal = e.message ?? 'run failed'
      if (e.name === 'loong.stop') {
        const v = e.value ?? {}
        if (typeof v.reason === 'string') stopReason = v.reason
        if (typeof v.steps === 'number' && typeof v.budget === 'number') {
          budget = { used: v.steps, budget: v.budget }
        }
      }
    },
  }).catch((err: unknown) => {
    fatal = err instanceof Error ? err.message : String(err)
  })
  clearTimeout(timer)

  const patch = await workspacePatch(dir)
  if (a.diff) writeFileSync(a.diff, patch, 'utf8')

  const result = {
    ok: fatal === null,
    status: fatal ? 'failed' : stopReason,
    workspace: dir,
    provider: a.provider,
    model: a.model,
    steps,
    budget,
    tools,
    failedTools: failed,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    text: text.trim(),
    patchChars: patch.length,
    patchPath: a.diff ?? null,
    error: fatal,
  }

  if (a.json) process.stdout.write(JSON.stringify(result) + '\n')
  else {
    process.stdout.write(
      `${result.status} · ${result.steps} steps · ${result.tools} tools · ${result.seconds}s · ${result.patchChars} patch chars\n` +
        (result.text ? `\n${result.text}\n` : '') +
        (a.diff ? `\npatch written to ${a.diff}\n` : ''),
    )
  }
  process.exit(result.ok ? 0 : 1)
}
