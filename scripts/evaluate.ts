/* This runner reports actual functional acceptance; --self-test tests the harness,
   not a language model. Live runs are opt-in via --model and use a fixed model. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { executeHeadless, type HeadlessArgs } from '../server/headless.ts'
import { loadTasks, prepareTask, selfTestTask, validateTask } from '../evals/harness.ts'
import type { ProviderId } from '../server/providers.ts'

const argv = process.argv.slice(2)
function option(name: string, fallback?: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}.`)
  return value
}
function integer(name: string, fallback: number, max: number): number {
  const value = Number(option(name, String(fallback)))
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`--${name} must be an integer between 1 and ${max}.`)
  return value
}

async function main(): Promise<void> {
  const allowedFlags = new Set(['--list', '--self-test', '--keep-workspaces', '--help'])
  const allowedValues = new Set(['--task', '--provider', '--model', '--base-url', '--steps', '--timeout', '--repetitions', '--output'])
  for (let i = 0; i < argv.length; i++) {
    if (allowedFlags.has(argv[i])) continue
    if (!allowedValues.has(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`)
    i++
  }
  if (argv.includes('--help')) {
    process.stdout.write('npm run eval:list\nnpm run eval:check\nnpm run eval -- --task clamp-boundaries --provider openrouter --model <id> --steps 60 --timeout 300\nCredentials: LOONG_PROVIDER_API_KEY or the provider-specific environment variable. --task all runs all 30 tasks.\n')
    return
  }
  const tasks = await loadTasks(), selectedId = option('task', 'all')
  const selected = selectedId === 'all' ? tasks : tasks.filter(task => task.id === selectedId)
  if (!selected.length) throw new Error(`Unknown task: ${selectedId}. Use --list.`)
  if (argv.includes('--list')) {
    process.stdout.write(JSON.stringify({ kind: 'evaluation-catalog', count: tasks.length, tasks: tasks.map(({ id, language, category, prompt }) => ({ id, language, category, prompt })) }, null, 2) + '\n')
    return
  }
  if (argv.includes('--self-test')) {
    const results = []
    for (const task of selected) {
      const result = await selfTestTask(task)
      results.push(result)
      process.stderr.write(`${result.passed ? 'PASS' : 'FAIL'} harness ${task.id}\n`)
    }
    const report = { kind: 'harness-self-test', notice: 'Validates known-good oracles and rejects seeded bugs. This is NOT an agent success score.', total: results.length, passed: results.filter(result => result.passed).length, results }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    if (report.passed !== report.total) process.exitCode = 1
    return
  }
  const model = option('model', process.env.LOONG_MODEL?.trim())
  if (!model) throw new Error('Live evaluation requires --model. Use --self-test to validate the harness without an API request.')
  const provider = option('provider', 'openrouter') as ProviderId
  if (!['openrouter', 'ollama', 'anthropic', 'openai', 'google', 'custom'].includes(provider)) throw new Error('Unknown provider.')
  const repetitions = integer('repetitions', 1, 10), steps = integer('steps', 60, 2000), timeout = integer('timeout', 300, 86_400)
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const output = resolve(option('output', `tmp/evaluations/${runId}`)!)
  await mkdir(output, { recursive: true })
  const results = []
  for (const task of selected) {
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      const workspace = await prepareTask(task)
      try {
        const args: HeadlessArgs = { task: task.prompt, workspace, provider, model, baseUrl: option('base-url'), steps, timeout, json: true, diff: resolve(output, `${task.id}-${repetition}.patch`) }
        const result = await executeHeadless(args)
        const acceptance = await validateTask(task, workspace)
        const row = { taskId: task.id, language: task.language, category: task.category, repetition, success: result.ok && acceptance.passed, functionalAcceptance: acceptance.passed, runtime: result, acceptance, ...(argv.includes('--keep-workspaces') ? { workspace } : {}) }
        results.push(row)
        await writeFile(resolve(output, `${task.id}-${repetition}.json`), JSON.stringify(row, null, 2) + '\n')
        process.stderr.write(`${row.success ? 'PASS' : 'FAIL'} ${task.id} #${repetition} runtime=${result.status} acceptance=${acceptance.passed}\n`)
      } finally {
        if (!argv.includes('--keep-workspaces')) await rm(workspace, { recursive: true, force: true })
      }
    }
  }
  const report = { kind: 'live-agent-evaluation', runId, provider, requestedModel: model, route: 'manual', taskIds: selected.map(task => task.id), repetitions, total: results.length, passed: results.filter(result => result.success).length, results }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ ...report, results: undefined, output }, null, 2) + '\n')
  if (report.passed !== report.total) process.exitCode = 1
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 2 })
