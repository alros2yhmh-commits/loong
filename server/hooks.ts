import { exec } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getWorkspace, clip } from './config.ts'

/* ---------------------------------------------------------------------------
   Hooks — the user's own code, at the seams of the run.

   Claude Code's second-strongest extensibility surface after MCP, and the
   reason a team can encode "never edit the migrations folder directly" as a
   check instead of a hope. Four moments, one file, `.loong/settings.json`:

     SessionStart   context injected into the system prompt before the run
     PreToolUse     can block a tool call (exit 2) or add context (stdout)
     PostToolUse    observes a result; its stdout rides back into the result
     Stop           can refuse the end of the run (exit 2) — the loop continues

   The shape is Claude Code's on purpose: a team that already writes hooks
   there can paste them in unchanged. Commands run with cwd = the workspace
   and a hard per-hook timeout; a hook that hangs is a bug in the hook, and it
   must not hang the run.
   --------------------------------------------------------------------------- */

export type HookEvent = 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop'

export interface HookSpec {
  /** tool name or fragment; empty matches everything */
  matcher?: string
  command: string
  timeout?: number
}

export type HookConfig = Partial<Record<HookEvent, HookSpec[]>>

const DEFAULT_TIMEOUT = 10_000
const MAX_OUT = 4_000

/** parse `.loong/settings.json` — a malformed file is an empty config, never a throw */
export function parseHookConfig(raw: string): HookConfig {
  try {
    const parsed = JSON.parse(raw) as { hooks?: unknown }
    const hooks = parsed.hooks
    if (!hooks || typeof hooks !== 'object') return {}
    const out: HookConfig = {}
    for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'] as HookEvent[]) {
      const list = (hooks as Record<string, unknown>)[event]
      if (!Array.isArray(list)) continue
      out[event] = list.filter(
        (h): h is HookSpec =>
          Boolean(h) &&
          typeof h === 'object' &&
          typeof (h as HookSpec).command === 'string' &&
          (h as HookSpec).command.trim().length > 0,
      )
    }
    return out
  } catch {
    return {}
  }
}

/** does this hook apply to a tool name? empty matcher matches everything */
export function hookMatches(spec: HookSpec, toolName: string): boolean {
  const m = spec.matcher?.trim()
  if (!m || m === '*') return true
  return toolName.includes(m)
}

function settingsPath(): string {
  return join(getWorkspace(), '.loong', 'settings.json')
}

let cached: { path: string; mtime: number; config: HookConfig } | null = null

/** read the config, cached on the file's mtime — edits take effect at once */
export function loadHooks(): HookConfig {
  const file = settingsPath()
  try {
    if (!existsSync(file)) {
      cached = null
      return {}
    }
    const mtime = statSync(file).mtimeMs
    /* keyed by path as well as mtime: the workspace can move, and the new
       workspace's hooks must not be shadowed by the old one's */
    if (cached && cached.path === file && cached.mtime === mtime) return cached.config
    const config = parseHookConfig(readFileSync(file, 'utf8'))
    cached = { path: file, mtime, config }
    return config
  } catch {
    return {}
  }
}

/** the hook input, on stdin as JSON — Claude Code's hooks read it the same way */
function runHook(spec: HookSpec, payload: unknown): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      spec.command,
      {
        cwd: getWorkspace(),
        timeout: Math.max(500, Math.min(spec.timeout ?? DEFAULT_TIMEOUT, 60_000)),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        env: { ...process.env, LOONG_HOOK_EVENT: '' },
      },
      (err, stdout, stderr) => {
        const code = err && 'code' in err ? Number((err as { code?: number }).code ?? 1) : 0
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    ).stdin?.end(JSON.stringify(payload))
  })
}

export interface PreToolDecision {
  /** false when a PreToolUse hook exited 2 — the tool must not run */
  allow: boolean
  /** why it was blocked, fed to the model */
  reason?: string
  /** extra context from stdout, folded into the tool's input prompt */
  context?: string
}

/** run every PreToolUse hook that matches; the FIRST block wins */
export async function runPreToolUse(
  toolName: string,
  input: unknown,
): Promise<PreToolDecision> {
  const specs = (loadHooks().PreToolUse ?? []).filter((s) => hookMatches(s, toolName))
  let context = ''
  for (const spec of specs) {
    const r = await runHook(spec, { tool: toolName, input })
    if (r.code === 2) {
      return {
        allow: false,
        reason: clip(r.stderr || r.stdout || `a PreToolUse hook refused ${toolName}`, MAX_OUT),
      }
    }
    if (r.stdout.trim()) context += (context ? '\n' : '') + clip(r.stdout.trim(), MAX_OUT)
  }
  return { allow: true, context: context || undefined }
}

/** PostToolUse observes; its stdout rides back into the result the model sees */
export async function runPostToolUse(
  toolName: string,
  input: unknown,
  output: string,
): Promise<string> {
  const specs = (loadHooks().PostToolUse ?? []).filter((s) => hookMatches(s, toolName))
  let note = ''
  for (const spec of specs) {
    const r = await runHook(spec, { tool: toolName, input, output: clip(output, MAX_OUT) })
    if (r.stdout.trim()) note += (note ? '\n' : '') + clip(r.stdout.trim(), MAX_OUT)
  }
  return note
}

/** SessionStart: text injected into the system prompt */
export async function runSessionStart(): Promise<string> {
  const specs = loadHooks().SessionStart ?? []
  let text = ''
  for (const spec of specs) {
    const r = await runHook(spec, { workspace: getWorkspace() })
    if (r.stdout.trim()) text += (text ? '\n\n' : '') + clip(r.stdout.trim(), MAX_OUT)
  }
  return text
}

/** Stop: exit 2 keeps the run going, with the stderr as the reason */
export async function runStopHooks(): Promise<{ done: boolean; reason?: string }> {
  const specs = loadHooks().Stop ?? []
  for (const spec of specs) {
    const r = await runHook(spec, { workspace: getWorkspace() })
    if (r.code === 2) {
      return {
        done: false,
        reason: clip(r.stderr || r.stdout || 'a Stop hook refused to end the run', MAX_OUT),
      }
    }
  }
  return { done: true }
}
