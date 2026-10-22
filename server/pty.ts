import { tool } from 'ai'
import { z } from 'zod'
import { spawn, type IPty } from 'node-pty'
import { getWorkspace } from './config.ts'
import { requestApproval } from './approvals.ts'

/* ---------------------------------------------------------------------------
   A real terminal, not a command runner.

   `shell` runs one command and returns when it exits. That is the wrong shape
   for the things people actually get stuck on: a test runner that asks a
   question, a dev server that never returns, a prompt that needs a keystroke.
   This is a PTY — a shell that stays alive between tool calls, so the agent can
   run, read, answer a prompt, and read again.

   The session is keyed by run: two runs get two shells, and a run that ends
   takes its shell with it. Nothing is left running behind the user's back.
   --------------------------------------------------------------------------- */

interface ShellSession {
  proc: IPty
  buffer: string
  exited: boolean
  /** when the shell last produced output — silence is information */
  lastOutputAt: number
}

/** a hung interactive program cannot hold a session forever: the shell is
 *  force-killed after this, whatever it was doing. A run is bounded; a shell
 *  outliving its run by ten minutes was a real leak. */
const SESSION_MAX_MS = 600_000

const sessions = new Map<string, ShellSession>()

/** the ring buffer a shell can fill before the oldest output is dropped */
const MAX_BUFFER = 200_000
/** how much of a single read the model gets */
const MAX_RETURN = 8_000

/** ANSI is for a terminal, not for a model — strip it before the text travels */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\u001b[()][A-Z0-9]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function ensure(runId: string): ShellSession {
  const existing = sessions.get(runId)
  if (existing && !existing.exited) return existing

  const isWin = process.platform === 'win32'
  const file = isWin ? process.env.ComSpec ?? 'cmd.exe' : process.env.SHELL ?? '/bin/bash'
  const args = isWin ? [] : ['-l']

  const proc = spawn(file, args, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: getWorkspace(),
    env: { ...process.env } as Record<string, string>,
    /* ConPTY is the working path on this machine. Its console-list helper
       (a forked child) prints "AttachConsole failed" when the shell exits
       under a GUI parent — noise in the log, not a crash. winpty, the
       alternative, hangs here, so it is not an option.

       NOTE ON THE WINDOW: node-pty creates a real console host (conhost) and
       has no windowsHide option — on Windows 11 that console can appear for a
       moment when the shell starts and when it is killed at the end of a run.
       It only happens when the model actually uses the terminal tool, never
       per message; the shell tool (one-shot commands) is fully hidden. */
  })

  const session: ShellSession = { proc, buffer: '', exited: false, lastOutputAt: Date.now() }
  proc.onData((data) => {
    session.buffer += data
    session.lastOutputAt = Date.now()
    if (session.buffer.length > MAX_BUFFER) session.buffer = session.buffer.slice(-MAX_BUFFER)
  })
  proc.onExit(() => {
    session.exited = true
  })
  /* the hard cap: a program that waits for input nobody sends would keep the
     pty (and its conhost) alive for the lifetime of the app. Unref'd: the cap
     must never be the reason a process stays alive. */
  const cap = setTimeout(() => {
    try { proc.kill() } catch { /* already gone */ }
  }, SESSION_MAX_MS)
  cap.unref()
  sessions.set(runId, session)
  return session
}

/** silence, described: a quiet shell is either working or waiting for input,
 *  and the model must be able to tell which it is looking at */
function idleNote(session: ShellSession): string {
  const secs = Math.round((Date.now() - session.lastOutputAt) / 1000)
  if (secs < 5) return ''
  return ` The shell has been silent for ${secs}s — it is either still running or waiting for input (use write to answer, kill to stop it).`
}

function drain(session: ShellSession): string {
  const raw = session.buffer
  session.buffer = ''
  const clean = stripAnsi(raw).trim()
  return clean.length > MAX_RETURN ? `…${clean.slice(-MAX_RETURN)}` : clean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function killShell(runId: string): Promise<void> {
  const session = sessions.get(runId)
  if (!session) return
  sessions.delete(runId)
  try {
    session.proc.kill()
  } catch {
    /* already gone */
  }
}

export async function killAllShells(): Promise<void> {
  const ids = [...sessions.keys()]
  await Promise.all(ids.map(killShell))
}

async function approve(
  runId: string,
  action: string,
  detail: string,
  autoApprove: boolean,
): Promise<boolean> {
  if (autoApprove) return true
  return requestApproval(runId, {
    tool: 'terminal',
    title: `terminal: ${action}`,
    detail,
    payload: {},
  })
}

export function createTerminalTool(runId: string, autoApprove = false) {
  return tool({
    description:
      'A real interactive shell in the workspace that stays alive between calls. Use run for a command, write to answer a prompt that is waiting, read to see what came after, kill to end it. Prefer shell for one-shot commands; use this when a program asks questions, needs a keystroke, or runs long.',
    inputSchema: z.object({
      action: z
        .enum(['run', 'write', 'read', 'kill'])
        .describe('run a command · write to the live process · read new output · kill the shell'),
      command: z.string().optional().describe('The command, for action=run.'),
      data: z
        .string()
        .optional()
        .describe('Raw input for action=write — include a trailing newline when the prompt expects Enter.'),
      waitMs: z
        .number()
        .int()
        .min(200)
        .max(15_000)
        .optional()
        .describe('How long to wait for output after the action. Default 1200ms.'),
    }),
    execute: async ({ action, command, data, waitMs }) => {
      const wait = waitMs ?? 1_200

      if (action === 'kill') {
        const ok = await approve(runId, 'kill', 'Close the interactive shell for this run.', autoApprove)
        if (!ok) return 'The user denied closing the shell.'
        await killShell(runId)
        return 'Shell closed.'
      }

      if (action === 'run') {
        const line = command?.trim()
        if (!line) return 'run needs a command.'
        const ok = await approve(runId, 'run', `Run in the live shell:\n\n${line}`, autoApprove)
        if (!ok) {
          return 'The user denied running that command. Do not retry it and do not look for another way to do the same thing.'
        }
        const session = ensure(runId)
        session.proc.write(`${line}\r`)
        await sleep(wait)
        const out = drain(session)
        return out || `(no output after ${wait}ms.)${idleNote(session)}`
      }

      if (action === 'write') {
        if (data === undefined) return 'write needs data.'
        const ok = await approve(runId, 'write', `Send to the live shell:\n\n${data}`, autoApprove)
        if (!ok) return 'The user denied sending that input.'
        const session = ensure(runId)
        session.proc.write(data)
        await sleep(wait)
        return drain(session) || `(no output)${idleNote(session)}`
      }

      /* read */
      const session = ensure(runId)
      await sleep(Math.min(wait, 800))
      return drain(session) || `(nothing new)${idleNote(session)}`
    },
  })
}
