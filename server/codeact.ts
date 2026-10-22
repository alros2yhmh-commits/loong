/* ---------------------------------------------------------------------------
   CodeAct — one small program instead of ten tool calls.

   smolagents' finding, ported rather than imported: an agent that writes code
   as its action space needs ~30% fewer steps than one that emits JSON tool
   calls, because a loop, a filter and three writes become one thought.

   The evidence that this matters here: a real Loong run spent 288 tool calls
   refusing the same imprecise oldText. That run was not a reasoning failure;
   it was a representation failure — every step had to be a separate call.

   The sandbox is a convenience, NOT a security boundary: `vm` cannot contain
   hostile code, and the agent already has a shell. Paths still go through
   resolveInside, writes are journalled for rewind, and `sh` is refused unless
   the run is full-trust.
   --------------------------------------------------------------------------- */

import { tool } from 'ai'
import { z } from 'zod'
import vm from 'node:vm'
import { readFile, writeFile, appendFile, readdir, stat, mkdir } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'
import { getWorkspace, resolveInside } from './config.ts'
import { recordWrite } from './journal.ts'

const execAsync = promisify(exec)
const MAX_OUTPUT = 40_000
const DEFAULT_MS = 20_000
const MAX_MS = 120_000

/** the bytes of a file before a write, for the rewind journal */
async function snapshot(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs)
  } catch {
    return null
  }
}

export function createCodeTool(autoApprove: boolean) {
  return tool({
    description:
      'Run one small JavaScript program against the workspace — the fastest way to do several file operations at once. The program may use (all async): fs.read(path), fs.write(path, text), fs.append(path, text), fs.list(path), fs.exists(path), and log(...) to print. ' +
      (autoApprove ? 'sh(cmd) runs a shell command in the workspace. ' : 'sh is unavailable unless the run is full-trust. ') +
      'Example: const files = await fs.list("src"); for (const f of files) { const t = await fs.read("src/" + f); if (t.includes("TODO")) log(f); }. ' +
      'Use it when a task needs a loop or several edits; use the dedicated tools for a single read or write. Returns everything you logged.',
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
      const out: string[] = []
      const log = (...parts: unknown[]) => {
        out.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))
      }
      const api = {
        fs: {
          read: async (p: string) => readFile(resolveInside(p), 'utf8'),
          write: async (p: string, text: string) => {
            const abs = resolveInside(p)
            const before = await snapshot(abs)
            await mkdir(dirname(abs), { recursive: true })
            await writeFile(abs, text, 'utf8')
            recordWrite('write', abs, before)
            return true
          },
          append: async (p: string, text: string) => {
            const abs = resolveInside(p)
            const before = await snapshot(abs)
            await mkdir(dirname(abs), { recursive: true })
            await appendFile(abs, text, 'utf8')
            recordWrite('write', abs, before)
            return true
          },
          list: async (p = '.') => {
            const abs = resolveInside(p)
            return (await readdir(abs, { withFileTypes: true })).map((d) =>
              d.isDirectory() ? `${d.name}/` : d.name,
            )
          },
          exists: async (p: string) => {
            try {
              await stat(resolveInside(p))
              return true
            } catch {
              return false
            }
          },
        },
        sh: async (cmd: string) => {
          if (!autoApprove) {
            throw new Error(
              'sh() is not available: this run is not full-trust. Ask the user to switch trust to auto, or use the shell tool (which asks first).',
            )
          }
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: getWorkspace(),
            timeout: timeoutMs ?? DEFAULT_MS,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          })
          const text = [stdout, stderr].filter(Boolean).join('\n').trim()
          if (text) out.push(text)
          return text
        },
        log,
      }

      const limit = Math.min(MAX_MS, Math.max(500, timeoutMs ?? DEFAULT_MS))
      const context = vm.createContext({
        fs: api.fs,
        sh: api.sh,
        log,
        console: { log },
        JSON,
        Math,
        Date,
        RegExp,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        Promise,
        Error,
      })

      let timer: NodeJS.Timeout | undefined
      try {
        const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'run_code.js' })
        const running = script.runInContext(context, { timeout: limit })
        await Promise.race([
          running,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`run_code exceeded ${limit}ms`)), limit)
          }),
        ])
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        out.push(`[error] ${message}`)
      } finally {
        if (timer) clearTimeout(timer)
      }

      const text = out.join('\n').trim()
      const clipped = text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (output clipped)` : text
      return clipped || '(the program printed nothing)'
    },
  })
}
