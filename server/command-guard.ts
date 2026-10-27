import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, dirname } from 'node:path'
import { accessSync, constants } from 'node:fs'
import { getWorkspace } from './config.ts'

/* ---------------------------------------------------------------------------
   The shell is a door with a keypad, not a hole in the wall.

   `resolveInside` governs every path the agent passes to a tool — but `shell`
   takes a *command*, and a command can name any file on the machine. That is
   how "read the folder I opened" turned into reading `Desktop/.agent-collab`
   and the agent's own source: the folder was the home directory, and cmd.exe
   does not ask.

   This screens the command text before it runs. It is not an OS sandbox and it
   does not pretend to be: a determined program can open a path it computes at
   runtime. What it does do is stop the ordinary case — an absolute path, a
   drive switch, a climb above the root, a known secrets folder — and say why,
   so the model is corrected instead of quietly succeeding.
   --------------------------------------------------------------------------- */

export interface CommandVerdict {
  ok: boolean
  reason?: string
}

const WIN_ABS = /(?<![A-Za-z0-9+.-])([A-Za-z]:[\\/][^\s"')|&;<>]*)/g
/* A drive switch is a bare `C:` at the start of a command segment, or after
   `cd` — not the colon in `echo note: ok`. The old pattern matched any loose
   `x:`, which refused ordinary prose. */
const WIN_DRIVE_SWITCH = /(?:^|&&|\|\||[&|;(\n]|\bcd\s+(?:\/d\s+)?)([A-Za-z]:)(?=$|[\s&|;)\n])/gi
const UNC = /(\\\\[^\s"')|&;<>]+)/g
const POSIX_ABS = /(?:^|[\s"'=(,<>])(\/[^\s"')|&;<>]+)/g
const HOME_REFS = /(%~?USERPROFILE%|%HOMEPATH%|%HOMEDRIVE%|%APPDATA%|%LOCALAPPDATA%|\$HOME|~[\\/])/i
/* Protected names are refused wherever they appear. `AppData` is not on this
   list: a workspace can legitimately live under it, and an absolute path there
   is already judged by the boundary check. The env-var spellings of it are. */
const SENSITIVE = /(\.agent-collab|\.ssh|\.aws|\.gnupg|\.password-store|\.kube|\.loong\b)/i

const SYSTEM_BIN_DIRS = new Set(['/bin', '/usr/bin', '/usr/local/bin', '/sbin', '/usr/sbin', '/usr/local/sbin'])

/** An absolute spelling of a system executable is equivalent to its PATH
 *  spelling, but a data argument naming that same path still crosses the jail.
 *  This is command screening, not an attempt to sandbox an interpreter. */
function isSystemCommand(path: string, prefix: string): boolean {
  if (!SYSTEM_BIN_DIRS.has(dirname(resolve(path)))) return false
  const before = prefix.replace(/["']$/, '')
  const segment = before.split(/&&|\|\||[|;\n]/).at(-1) ?? ''
  if (!/^\s*(?:(?:command|exec|env)\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*$/.test(segment)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** a path stays inside when it is the root or sits under it — canonically-ish */
function inside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function fromRoot(root: string, p: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(root, p)
}

export function screenCommand(command: string, root = getWorkspace()): CommandVerdict {
  const text = String(command ?? '')
  if (!text.trim()) return { ok: true }

  if (SENSITIVE.test(text)) {
    return { ok: false, reason: 'the command mentions a protected folder (agent data, keys or credentials)' }
  }

  if (HOME_REFS.test(text)) {
    const home = homedir()
    if (!inside(root, home)) {
      return { ok: false, reason: `the command reaches into the home folder, which is outside ${root}` }
    }
  }

  const check = (raw: string): CommandVerdict | null => {
    const candidate = raw.trim().replace(/^["']|["']$/g, '')
    if (!candidate) return null
    let abs: string
    try {
      abs = fromRoot(root, candidate)
    } catch {
      return null
    }
    if (!inside(root, abs)) {
      return { ok: false, reason: `"${candidate}" is outside the open folder (${root})` }
    }
    return null
  }

  const patterns: RegExp[] = process.platform === 'win32' ? [WIN_ABS, UNC] : [POSIX_ABS]
  for (const re of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (process.platform !== 'win32') {
        if (m[1] === '/dev/null') continue
        const pathStart = m.index + m[0].indexOf(m[1])
        if (isSystemCommand(m[1], text.slice(0, pathStart))) continue
      }
      const verdict = check(m[1])
      if (verdict) return verdict
    }
  }

  if (process.platform === 'win32') {
    WIN_DRIVE_SWITCH.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIN_DRIVE_SWITCH.exec(text)) !== null) {
      /* `C:` without a slash changes to that drive's current directory —
         a different drive is by definition outside the root */
      const drive = resolve(`${m[1]}\\`)
      if (!inside(root, drive)) {
        return { ok: false, reason: `"${m[1]}" switches to another drive, outside the open folder` }
      }
    }
  }

  /* a bare `..` is only a problem when it climbs above the root. Chains such
     as `cd sub && cd ..` resolve to the root itself and are allowed. */
  const segments = text.match(/(?:^|[\s"'=(,])((?:\.\.[\\/])+[^\s"')|&;<>]*)/g) ?? []
  for (const hit of segments) {
    const candidate = hit.replace(/^[\s"'=(,]+/, '')
    const verdict = check(candidate)
    if (verdict) return verdict
  }

  return { ok: true }
}
