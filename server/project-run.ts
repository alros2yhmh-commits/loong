import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { tool } from 'ai'
import { z } from 'zod'
import { getCapabilities, getWorkspace, resolveInside } from './config.ts'
import { requestApproval } from './approvals.ts'
import { browserAction, browserAvailable, shotsDir } from './browser.ts'
import { compareScreens } from './image-diff.ts'

/* ---------------------------------------------------------------------------
   Run the thing, then look at it.

   An agent that edits a front end and never opens it is guessing. This is the
   missing half of the loop: start the project's own dev server, wait until the
   port actually answers, take a screenshot, and — when something changed —
   compare the two pictures and report the pixels that moved.

   Nothing here knows any particular framework. It reads the project's own
   manifest, uses the project's own script, and says so plainly when the stack
   is one it does not recognise. Guessing a command is how a tool lies.
   --------------------------------------------------------------------------- */

interface Running {
  proc: ChildProcess
  label: string
  url: string | null
  output: string
  exited: boolean
}

const running = new Map<string, Running>()
const MAX_OUTPUT = 40_000

interface Launch {
  label: string
  command: string
  args: string[]
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** what the project itself says starts it — never a guess */
export function detectProject(root = getWorkspace()): Launch {
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath)
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>
    const script = ['dev', 'develop', 'start', 'serve', 'preview'].find((s) => scripts[s])
    if (!script) {
      throw new Error(
        'package.json has no dev/start/serve/preview script. Tell the user which command starts this project.',
      )
    }
    const manager = existsSync(join(root, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(join(root, 'yarn.lock'))
        ? 'yarn'
        : existsSync(join(root, 'bun.lockb'))
          ? 'bun'
          : 'npm'
    const bin = process.platform === 'win32' ? `${manager}.cmd` : manager
    return {
      label: `${manager} run ${script}`,
      command: bin,
      args: manager === 'yarn' || manager === 'pnpm' || manager === 'bun'
        ? [script]
        : ['run', script],
    }
  }

  if (existsSync(join(root, 'Cargo.toml'))) {
    return { label: 'cargo run', command: 'cargo', args: ['run'] }
  }
  if (existsSync(join(root, 'go.mod'))) {
    return { label: 'go run .', command: 'go', args: ['run', '.'] }
  }
  if (existsSync(join(root, 'manage.py'))) {
    return { label: 'django', command: 'python', args: ['manage.py', 'runserver'] }
  }
  if (existsSync(join(root, 'app.py'))) {
    return { label: 'python app.py', command: 'python', args: ['app.py'] }
  }

  throw new Error(
    'I do not recognise how to start this project. Look for a README or a manifest and tell the user the command; do not invent one.',
  )
}

function noteOutput(entry: Running, chunk: string): void {
  entry.output += chunk
  if (entry.output.length > MAX_OUTPUT) entry.output = entry.output.slice(-MAX_OUTPUT)
  if (!entry.url) {
    const match = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)/i.exec(chunk)
    if (match) entry.url = `http://127.0.0.1:${match[1]}`
  }
}

function startProject(runId: string, launch: Launch): Running {
  const previous = running.get(runId)
  if (previous) void stopProject(runId)

  const proc = spawn(launch.command, launch.args, {
    cwd: getWorkspace(),
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    shell: process.platform === 'win32',
    windowsHide: true,
    detached: process.platform !== 'win32',
  })

  const entry: Running = {
    proc,
    label: launch.label,
    url: null,
    output: '',
    exited: false,
  }
  proc.stdout?.on('data', (d) => noteOutput(entry, String(d)))
  proc.stderr?.on('data', (d) => noteOutput(entry, String(d)))
  proc.on('exit', () => {
    entry.exited = true
  })
  running.set(runId, entry)
  return entry
}

async function portAnswers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) })
    return res.status > 0
  } catch {
    return false
  }
}

/** the ports the common frameworks use when their banner is quiet */
const DEFAULT_PORTS = [5173, 3000, 4321, 8080, 8000, 4200]

async function resolveUrl(entry: Running, timeoutMs: number): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (entry.url && (await portAnswers(entry.url))) return entry.url
    if (entry.exited) break
    await new Promise((r) => setTimeout(r, 700))
  }
  for (const port of DEFAULT_PORTS) {
    const candidate = `http://127.0.0.1:${port}`
    if (await portAnswers(candidate)) return candidate
  }
  throw new Error(
    `The server started but no port answered within ${Math.round(timeoutMs / 1000)}s.\n\n${entry.output.slice(-1_500)}`,
  )
}

export async function stopProject(runId: string): Promise<void> {
  const entry = running.get(runId)
  if (!entry) return
  running.delete(runId)
  const pid = entry.proc.pid
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      process.kill(-pid, 'SIGTERM')
    }
  } catch {
    try {
      entry.proc.kill()
    } catch {
      /* already gone */
    }
  }
}

export async function killAllProjects(): Promise<void> {
  await Promise.all([...running.keys()].map(stopProject))
}

async function approve(
  runId: string,
  title: string,
  detail: string,
  autoApprove: boolean,
): Promise<boolean> {
  if (autoApprove) return true
  return requestApproval(runId, { tool: 'run_project', title, detail, payload: {} })
}

export function createRunProjectTool(runId: string, autoApprove = false) {
  return tool({
    description:
      'Start this project with its own dev/start script, wait until the port answers, and take a screenshot of the running app. Use this after a front-end change — reading the code is not the same as seeing it run. Returns the URL, the server output, and the screenshot.',
    inputSchema: z.object({
      waitMs: z
        .number()
        .int()
        .min(2_000)
        .max(120_000)
        .optional()
        .describe('How long to wait for the port. Default 45000ms.'),
    }),
    execute: async ({ waitMs }) => {
      let launch: Launch
      try {
        launch = detectProject()
      } catch (err) {
        return (err as Error).message
      }

      const approved = await approve(
        runId,
        `start the project: ${launch.label}`,
        `This starts a process in the workspace:\n\n${launch.command} ${launch.args.join(' ')}\n\nIt stays running for this run and is stopped when the run ends.`,
        autoApprove,
      )
      if (!approved) return 'The user denied starting the project.'

      const entry = startProject(runId, launch)
      let url: string
      try {
        url = await resolveUrl(entry, waitMs ?? 45_000)
      } catch (err) {
        return (err as Error).message
      }

      const tail = entry.output.slice(-2_500)
      if (!getCapabilities().browser || !browserAvailable()) {
        return `Started ${launch.label} at ${url}\n\n${tail}\n\nThe browser is unavailable, so there is no screenshot.`
      }

      try {
        await browserAction('open', url)
        const shot = await browserAction('screenshot', '')
        return [
          `Started ${launch.label} at ${url}`,
          '',
          tail,
          '',
          shot.shot ? `Screenshot saved.\nSHOT:${shot.shot}` : 'No screenshot was produced.',
        ].join('\n')
      } catch (err) {
        return `Started ${launch.label} at ${url}\n\n${tail}\n\nScreenshot failed: ${(err as Error).message}`
      }
    },
  })
}

/** an image path is either inside the workspace or one of our own screenshots */
function resolveImage(path: string): string {
  if (isAbsolute(path)) {
    const shots = shotsDir()
    const rel = relative(shots, path)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return path
    throw new Error(`Refused: ${path} is outside the workspace and the screenshot folder.`)
  }
  return resolveInside(path)
}

export const compareScreensTool = tool({
  description:
    'Compare two screenshots of the same page and report how many pixels changed, plus a diff image. Use it after a visual change: take a screenshot before, change the code, take one after, then call this. Equal-size PNGs only.',
  inputSchema: z.object({
    before: z.string().describe('Path to the first screenshot.'),
    after: z.string().describe('Path to the second screenshot.'),
  }),
  execute: async ({ before, after }) => {
    try {
      const beforePath = resolveImage(before)
      const afterPath = resolveImage(after)
      const diffPath = join(shotsDir(), `diff-${Date.now()}.png`)
      const result = compareScreens(beforePath, afterPath, diffPath)
      const verdict =
        result.percent < 0.05
          ? 'No visible change.'
          : result.percent < 2
            ? 'A small change.'
            : 'A large change.'
      return [
        `${verdict} ${result.changed.toLocaleString()} of ${result.total.toLocaleString()} pixels changed (${result.percent.toFixed(2)}%).`,
        `Viewport: ${result.width}×${result.height}.`,
        `SHOT:${result.diffPath}`,
      ].join('\n')
    } catch (err) {
      return `Could not compare the screenshots: ${(err as Error).message}`
    }
  },
})
