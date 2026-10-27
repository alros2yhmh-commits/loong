import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const exec = promisify(execFile)
export interface EvaluationTask {
  id: string
  category: string
  language: 'en' | 'ar'
  prompt: string
  files: Record<string, string>
  oracle: Record<string, string>
  checks: string
}
export interface ValidationResult { passed: boolean; output: string; seconds: number }

export async function loadTasks(): Promise<EvaluationTask[]> {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'tasks.json')
  const raw = JSON.parse(await readFile(file, 'utf8')) as { version: number; tasks: EvaluationTask[] }
  if (raw.version !== 1 || !Array.isArray(raw.tasks)) throw new Error('Unsupported evaluation manifest.')
  const seen = new Set<string>()
  for (const task of raw.tasks) {
    if (!/^[a-z0-9-]+$/.test(task.id) || seen.has(task.id)) throw new Error(`Invalid/duplicate task: ${task.id}`)
    if (!task.prompt || !task.checks || !task.files || !task.oracle) throw new Error(`Incomplete task: ${task.id}`)
    seen.add(task.id)
  }
  return raw.tasks
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(root, name), rel = relative(root, target)
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || resolve(root) === target) throw new Error(`Unsafe fixture path: ${name}`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
}

/** Creates disposable repositories only; never mutates the Loong checkout. */
export async function prepareTask(task: EvaluationTask, oracle = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `loong-eval-${task.id}-`))
  await writeFiles(root, task.files)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: `loong-eval-${task.id}`, private: true, type: 'module',
    scripts: { check: 'node --check src/module.mjs' },
  }, null, 2))
  await writeFile(join(root, 'README.md'), `${task.prompt}\n\nRun npm run check for syntax validation. Add your own functional tests; independent acceptance tests run after the task. No dependencies need to be installed.\n`)
  const git = (args: string[]) => exec('git', args, { cwd: root, windowsHide: true })
  await git(['init', '-q'])
  await git(['-c', 'user.name=Loong Evaluation', '-c', 'user.email=loong-eval@example.invalid', 'add', '.'])
  await git(['-c', 'user.name=Loong Evaluation', '-c', 'user.email=loong-eval@example.invalid', 'commit', '-qm', 'Evaluation fixture baseline'])
  if (oracle) await writeFiles(root, task.oracle)
  return root
}

/** Validator lives outside the writable task root. It is run by the evaluator,
 * not by the model. This is isolation from ordinary workspace tools, not an OS
 * security boundary against an unrestricted same-user process. */
export async function validateTask(task: EvaluationTask, root: string): Promise<ValidationResult> {
  const validatorDir = await mkdtemp(join(tmpdir(), 'loong-eval-validator-'))
  const validator = join(validatorDir, 'acceptance.mjs')
  const moduleUrl = pathToFileURL(join(root, 'src', 'module.mjs')).href
  const source = `import assert from 'node:assert/strict';\nconst m=await import(${JSON.stringify(moduleUrl)});\n${task.checks}\n`
  await writeFile(validator, source)
  const start = Date.now()
  try {
    const { stdout, stderr } = await exec(process.execPath, [validator], {
      cwd: validatorDir, timeout: 10_000, windowsHide: true, maxBuffer: 512 * 1024,
    })
    return { passed: true, output: [stdout, stderr].filter(Boolean).join('\n').slice(-8_000), seconds: (Date.now() - start) / 1000 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    return { passed: false, output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').slice(-8_000), seconds: (Date.now() - start) / 1000 }
  } finally { await rm(validatorDir, { recursive: true, force: true }) }
}

export async function selfTestTask(task: EvaluationTask): Promise<{ id: string; passed: boolean; baselineRejected: boolean; oracleAccepted: boolean; error?: string }> {
  const root = await prepareTask(task)
  try {
    const baseline = await validateTask(task, root)
    await writeFiles(root, task.oracle)
    const oracle = await validateTask(task, root)
    return { id: task.id, passed: !baseline.passed && oracle.passed, baselineRejected: !baseline.passed, oracleAccepted: oracle.passed,
      ...(!oracle.passed ? { error: oracle.output } : baseline.passed ? { error: 'The intentionally broken fixture passed acceptance.' } : {}) }
  } finally { await rm(root, { recursive: true, force: true }) }
}
