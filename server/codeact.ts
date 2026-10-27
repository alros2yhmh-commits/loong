/* ---------------------------------------------------------------------------
   CodeAct — one small program instead of ten tool calls.

   smolagents' finding, ported rather than imported: an agent that writes code
   as its action space needs ~30% fewer steps than one that emits JSON tool
   calls, because a loop, a filter and three writes become one thought.

   The evidence that this matters here: a real Loong run spent 288 tool calls
   refusing the same imprecise oldText. That run was not a reasoning failure;
   it was a representation failure — every step had to be a separate call.

   ---------------------------------------------------------------------------
   THE BOUNDARY

   The model's code never runs in this process. It runs in a child Node started
   with `--permission` and no `--allow-*` flags, so the OS-enforced permission
   model refuses it: filesystem, child_process, worker_threads, inspector and
   native addons. `vm` is not used and never was a boundary — handing a context
   the host `Object` hands it the host `Function`, and from there the host
   realm, which is a two-line escape to `require('child_process')`.

   Everything the program can actually do arrives over an IPC channel and is
   performed HERE, in the trusted parent: paths go through resolveInside, writes
   take a lease and are journalled for rewind, and `sh` is refused unless the run
   is full-trust. Approving a run_code call therefore approves a known set of
   capabilities, not arbitrary execution.

   Node's permission model has no network scope, so the child's prelude also
   disables fetch/WebSocket and the socket primitives. That layer is
   best-effort; the process boundary above it is not.
   --------------------------------------------------------------------------- */

import { tool } from 'ai'
import { z } from 'zod'
import { exec, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getWorkspace, resolveInside } from './config.ts'
import { recordWrite } from './journal.ts'
import { acquireWriteLease, type LeaseHandle } from './leases.ts'
import { runWithRunId } from './run-context.ts'

const execAsync = promisify(exec)
const MAX_OUTPUT = 40_000
const DEFAULT_MS = 20_000
const MAX_MS = 120_000
/** the child's own boot, on top of the program's limit */
const STARTUP_MS = 5_000

/** the bytes of a file before a write, for the rewind journal */
async function snapshot(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs)
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
   The child. One fixed prelude, delivered as `--eval`; the model's own code
   arrives separately over IPC and is imported as a data: URL, so no user text
   is ever concatenated into a command line (Windows caps argv at 32 KB and
   interpolating would also be an injection).
   --------------------------------------------------------------------------- */
const PRELUDE = `
const NET = 'run_code has no network access. Use the fetch_url or web_search tool instead.'
const refuse = (m) => function () { throw new Error(m) }

globalThis.fetch = refuse(NET)
if ('WebSocket' in globalThis) globalThis.WebSocket = refuse(NET)

for (const name of ['node:net', 'node:tls', 'node:dgram']) {
  try {
    const m = (await import(name)).default
    if (!m) continue
    if (name === 'node:net' || name === 'node:tls') {
      if (m.Socket?.prototype) m.Socket.prototype.connect = refuse(NET)
      if (m.Server?.prototype) m.Server.prototype.listen = refuse(NET)
      if (typeof m.connect === 'function') m.connect = refuse(NET)
      if (typeof m.createConnection === 'function') m.createConnection = refuse(NET)
      if (typeof m.createServer === 'function') m.createServer = refuse(NET)
    }
    if (name === 'node:dgram' && m.Socket?.prototype) {
      m.Socket.prototype.bind = refuse(NET)
      m.Socket.prototype.send = refuse(NET)
      if (typeof m.createSocket === 'function') m.createSocket = refuse(NET)
    }
  } catch {}
}

let nextId = 0
const waiting = new Map()

process.on('message', (m) => {
  if (!m || typeof m.id !== 'number') return
  const settle = waiting.get(m.id)
  if (!settle) return
  waiting.delete(m.id)
  m.ok ? settle.resolve(m.value) : settle.reject(new Error(m.error))
})

function rpc(op, args) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    process.send({ t: 'rpc', id, op, args })
  })
}

const fmt = (p) => (typeof p === 'string' ? p : JSON.stringify(p))

globalThis.log = (...parts) => process.send({ t: 'log', v: parts.map(fmt).join(' ') })
globalThis.console = {
  log: globalThis.log,
  info: globalThis.log,
  warn: globalThis.log,
  error: globalThis.log,
  debug: globalThis.log,
}
globalThis.fs = {
  read: (p) => rpc('read', [p]),
  write: (p, text) => rpc('write', [p, text]),
  append: (p, text) => rpc('append', [p, text]),
  list: (p = '.') => rpc('list', [p]),
  exists: (p) => rpc('exists', [p]),
}
globalThis.sh = (cmd) => rpc('sh', [cmd])

process.on('unhandledRejection', (e) => process.send({ t: 'log', v: '[unhandled] ' + fmt(e?.message ?? e) }))

process.on('message', async (m) => {
  if (!m || m.t !== 'run') return
  try {
    await import('data:text/javascript;base64,' + m.b64)
    process.send({ t: 'end' })
  } catch (e) {
    process.send({ t: 'end', error: fmt(e?.message ?? e) })
  }
})

process.send({ t: 'ready' })
`

/** what the child may ask the parent to do */
type Op = 'read' | 'write' | 'append' | 'list' | 'exists' | 'sh'

interface ChildMessage {
  t: 'ready' | 'log' | 'rpc' | 'end'
  id?: number
  op?: Op
  args?: unknown[]
  v?: string
  error?: string
}

export function createCodeTool(autoApprove: boolean, runId: string) {
  return tool({
    description:
      'Run one small JavaScript program against the workspace — the fastest way to do several file operations at once. The program may use (all async): fs.read(path), fs.write(path, text), fs.append(path, text), fs.list(path), fs.exists(path), and log(...) to print. ' +
      (autoApprove
        ? 'sh(cmd) runs a shell command in the workspace. '
        : 'sh is unavailable unless the run is full-trust. ') +
      'There is no network access inside the program — use fetch_url or web_search for that. ' +
      'Example: const files = await fs.list("src"); for (const f of files) { const t = await fs.read("src/" + f); if (t.includes("TODO")) log(f); }. ' +
      'Use it when a task needs a loop or several edits; use the dedicated tools for a single read or write. Returns everything you logged. Requires human approval before it runs.',
    inputSchema: z.object({
      code: z.string().describe('JavaScript to run. Top-level await is allowed.'),
      timeoutMs: z
        .number()
        .int()
        .min(500)
        .max(MAX_MS)
        .optional()
        .describe(`Wall-clock limit. Default ${DEFAULT_MS}ms, max ${MAX_MS}ms.`),
    }),
    execute: async ({ code, timeoutMs }) => {
      const limit = Math.min(MAX_MS, Math.max(500, timeoutMs ?? DEFAULT_MS))
      const out: string[] = []
      /* every path this program touched, so the approval card and the lease
         system see the same set of files the write path does */
      const leases = new Map<string, LeaseHandle>()

      const child: ChildProcess = spawn(
        process.execPath,
        [
          '--permission',
          '--no-addons',
          '--disallow-code-generation-from-strings',
          '--input-type=module',
          '--eval',
          PRELUDE,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          /* a stripped environment: the child needs nothing, and an inherited
             NODE_OPTIONS would be a way back in */
          env: {
            PATH: process.env.PATH ?? '',
            SYSTEMROOT: process.env.SYSTEMROOT ?? '',
            TMPDIR: process.env.TMPDIR ?? '',
          },
          windowsHide: true,
        },
      )

      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString().trim()
        if (text) out.push(text)
      })
      child.stdout?.resume()

      /* one lease per path, taken the first time the program writes it */
      const leaseFor = async (abs: string): Promise<LeaseHandle | null> => {
        const held = leases.get(abs)
        if (held) return held
        const got = await acquireWriteLease(runId, [abs])
        if (got) leases.set(abs, got)
        return got
      }

      const serve = async (op: Op, args: unknown[]): Promise<unknown> => {
        const str = (i: number) => String(args[i] ?? '')
        switch (op) {
          case 'read':
            return readFile(resolveInside(str(0)), 'utf8')
          case 'write': {
            const abs = resolveInside(str(0))
            if (!(await leaseFor(abs))) throw new Error(`${str(0)} is locked by another session`)
            const before = await snapshot(abs)
            await mkdir(dirname(abs), { recursive: true })
            await writeFile(abs, str(1), 'utf8')
            await runWithRunId(runId, async () => recordWrite('write', abs, before))
            return true
          }
          case 'append': {
            const abs = resolveInside(str(0))
            if (!(await leaseFor(abs))) throw new Error(`${str(0)} is locked by another session`)
            const before = await snapshot(abs)
            await mkdir(dirname(abs), { recursive: true })
            await appendFile(abs, str(1), 'utf8')
            await runWithRunId(runId, async () => recordWrite('write', abs, before))
            return true
          }
          case 'list': {
            const entries = await readdir(resolveInside(str(0) || '.'), { withFileTypes: true })
            return entries.map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
          }
          case 'exists':
            try {
              await stat(resolveInside(str(0)))
              return true
            } catch {
              return false
            }
          case 'sh': {
            if (!autoApprove) {
              throw new Error(
                'sh() is not available: this run is not full-trust. Ask the user to switch trust to auto, or use the shell tool (which asks first).',
              )
            }
            const { stdout, stderr } = await execAsync(str(0), {
              cwd: getWorkspace(),
              timeout: limit,
              maxBuffer: 8 * 1024 * 1024,
              windowsHide: true,
              shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            })
            const text = [stdout, stderr].filter(Boolean).join('\n').trim()
            if (text) out.push(text)
            return text
          }
        }
      }

      const reply = (id: number, ok: boolean, value?: unknown, error?: string) => {
        if (child.connected) child.send({ id, ok, value, error })
      }

      const done = new Promise<string>((resolve) => {
        let settled = false
        const finish = (why: string) => {
          if (settled) return
          settled = true
          clearTimeout(deadline)
          resolve(why)
        }

        const deadline = setTimeout(() => finish(`run_code exceeded ${limit}ms`), limit + STARTUP_MS)

        child.on('message', (raw: ChildMessage) => {
          if (raw.t === 'ready') {
            child.send({ t: 'run', b64: Buffer.from(code, 'utf8').toString('base64') })
            return
          }
          if (raw.t === 'log') {
            if (raw.v) out.push(raw.v)
            return
          }
          if (raw.t === 'end') {
            if (raw.error) out.push(`[error] ${raw.error}`)
            finish('')
            return
          }
          if (raw.t === 'rpc' && typeof raw.id === 'number' && raw.op) {
            const { id, op, args } = raw
            void serve(op, Array.isArray(args) ? args : [])
              .then((value) => reply(id, true, value))
              .catch((err) => reply(id, false, undefined, (err as Error).message))
          }
        })

        child.on('error', (err) => {
          out.push(`[error] ${err.message}`)
          finish('')
        })
        /* an early exit means the sandbox refused something at startup */
        child.on('exit', (code, signal) => {
          if (!settled && (code !== 0 || signal)) {
            out.push(`[error] the sandbox exited early (code ${code}, signal ${signal ?? 'none'})`)
          }
          finish('')
        })
      })

      const why = await done
      /* SIGKILL, not SIGTERM: the child may be blocked in a loop and would
         never run a handler */
      child.kill('SIGKILL')
      for (const handle of leases.values()) handle.release()
      leases.clear()

      if (why) out.push(`[error] ${why}`)
      const text = out.join('\n').trim()
      const clipped = text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (output clipped)` : text
      return clipped || '(the program printed nothing)'
    },
  })
}
