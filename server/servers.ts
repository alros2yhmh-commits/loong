import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { getWorkspace, haveWorkspace, resolveInside, displayPath } from './config.ts'
import { screenCommand } from './command-guard.ts'

/* ---------------------------------------------------------------------------
   Dev servers that outlive the run that started them.

   `shell` runs one command and waits for it. A dev server does the opposite: it
   stays up, keeps talking, and is read later. Bolting that onto the shell tool
   made every web task a fight with a timeout. These are managed child processes
   with a bounded log ring, an id the agent can refer to across runs, and a stop
   that kills the whole tree (npm spawns a child; killing npm alone leaves the
   server holding the port).

   The cap is small on purpose. A desktop app has no business starting forty
   servers; when the cap is reached the answer names the running ones.
   --------------------------------------------------------------------------- */

const MAX_SERVERS = 8
const MAX_LINES = 300
const MAX_LINE_CHARS = 600

export interface ServerInfo {
  id: string
  name: string
  command: string
  cwd: string
  pid: number | null
  startedAt: number
  status: 'running' | 'exited'
  code: number | null
  lines: number
}

interface Managed extends ServerInfo {
  child: ChildProcess | null
  log: string[]
  partial: { out: string; err: string }
}

const servers = new Map<string, Managed>()

function clipLine(line: string): string {
  const clean = line.replace(/\r$/, '')
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS - 1)}…` : clean
}

function push(server: Managed, stream: 'out' | 'err', chunk: string): void {
  const joined = server.partial[stream] + chunk
  const parts = joined.split(/\r?\n/)
  server.partial[stream] = parts.pop() ?? ''
  for (const line of parts) {
    const text = stream === 'err' ? `! ${clipLine(line)}` : clipLine(line)
    server.log.push(text)
  }
  if (server.log.length > MAX_LINES) server.log = server.log.slice(server.log.length - MAX_LINES)
  server.lines = server.log.length
}

export function listServers(): ServerInfo[] {
  return [...servers.values()]
    .map(({ child: _child, log: _log, partial: _partial, ...info }) => info)
    .sort((a, b) => b.startedAt - a.startedAt)
}

export function serverLogs(id: string, lines = 60): { server: ServerInfo; text: string } | null {
  const server = servers.get(id)
  if (!server) return null
  const want = Math.max(1, Math.min(MAX_LINES, Math.floor(lines)))
  const tail = server.log.slice(-want)
  const note =
    server.status === 'running'
      ? `still running (pid ${server.pid})`
      : `exited${server.code === null ? '' : ` with code ${server.code}`}`
  return { server: info(server), text: `[${server.name} · ${note} · ${server.log.length} line(s)]\n${tail.join('\n') || '(no output yet)'}` }
}

function info(server: Managed): ServerInfo {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    cwd: server.cwd,
    pid: server.pid,
    startedAt: server.startedAt,
    status: server.status,
    code: server.code,
    lines: server.log.length,
  }
}

export function startServer(input: { command: string; cwd?: string; name?: string }): {
  ok: boolean
  text: string
  server?: ServerInfo
} {
  const command = String(input.command ?? '').trim()
  if (!command) return { ok: false, text: 'server_start needs a command, e.g. "npm run dev".' }
  if (command.length > 1_000) return { ok: false, text: 'That command is too long to be a dev server.' }
  if (!haveWorkspace()) return { ok: false, text: 'No folder is open, so there is nowhere to start it.' }

  const running = [...servers.values()].filter((s) => s.status === 'running')
  if (running.length >= MAX_SERVERS) {
    return {
      ok: false,
      text: `Already running ${running.length} servers (the cap is ${MAX_SERVERS}). Stop one first: ${running
        .map((s) => `${s.name} [${s.id}]`)
        .join(', ')}.`,
    }
  }

  const verdict = screenCommand(command)
  if (!verdict.ok) return { ok: false, text: `Refused: ${verdict.reason}.` }

  let cwd: string
  try {
    cwd = input.cwd ? resolveInside(input.cwd) : getWorkspace()
  } catch (err) {
    return { ok: false, text: `That folder is outside the open project: ${(err as Error).message}` }
  }
  if (!existsSync(cwd)) return { ok: false, text: `That folder does not exist: ${displayPath(cwd)}` }

  const name = String(input.name ?? '').trim().slice(0, 60) || command.slice(0, 60)
  const id = randomUUID().slice(0, 8)
  let child: ChildProcess
  try {
    child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      /* a process group is what makes the tree killable on POSIX; on Windows
         taskkill /t walks the tree itself */
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return { ok: false, text: `Could not start it: ${(err as Error).message}` }
  }

  const server: Managed = {
    id,
    name,
    command,
    cwd,
    pid: child.pid ?? null,
    startedAt: Date.now(),
    status: 'running',
    code: null,
    lines: 0,
    child,
    log: [],
    partial: { out: '', err: '' },
  }
  servers.set(id, server)

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => push(server, 'out', chunk))
  child.stderr?.on('data', (chunk: string) => push(server, 'err', chunk))
  child.on('error', (err) => {
    server.log.push(`! ${err.message}`)
    server.status = 'exited'
    server.child = null
  })
  child.on('exit', (code) => {
    if (server.partial.out) push(server, 'out', '\n')
    if (server.partial.err) push(server, 'err', '\n')
    server.status = 'exited'
    server.code = code
    server.child = null
    server.log.push(`— exited${code === null ? '' : ` with code ${code}`}`)
    if (server.log.length > MAX_LINES) server.log = server.log.slice(server.log.length - MAX_LINES)
    server.lines = server.log.length
  })

  return {
    ok: true,
    text: `Started "${name}" in ${displayPath(cwd)} — id ${id}${child.pid ? `, pid ${child.pid}` : ''}. Read it with server_logs (id ${id}).`,
    server: info(server),
  }
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
        killer.on('exit', () => resolve())
        killer.on('error', () => resolve())
        return
      }
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        process.kill(pid, 'SIGTERM')
      }
      resolve()
    } catch {
      resolve()
    }
  })
}

export async function stopServer(id: string): Promise<{ ok: boolean; text: string }> {
  const server = servers.get(id)
  if (!server) return { ok: false, text: `No managed server with id ${id}. server_list shows the running ones.` }
  if (server.status !== 'running' || !server.pid) {
    return { ok: true, text: `"${server.name}" already exited.` }
  }
  server.status = 'exited'
  await killTree(server.pid)
  server.child = null
  return { ok: true, text: `Stopped "${server.name}" (pid ${server.pid}) and its child processes.` }
}

export async function stopAllServers(): Promise<void> {
  const running = [...servers.values()].filter((s) => s.status === 'running' && s.pid)
  await Promise.all(running.map((s) => killTree(s.pid!)))
  for (const s of running) {
    s.status = 'exited'
    s.child = null
  }
}

/** only for tests */
export function resetServersForTests(): void {
  servers.clear()
}
