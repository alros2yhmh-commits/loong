import { AsyncLocalStorage } from 'node:async_hooks'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, dirname, basename, sep } from 'node:path'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'

/* ---------------------------------------------------------------------------
   Runtime configuration.

   The one rule that matters here: the agent may only touch files under the
   workspace, and that boundary is enforced in `resolveInside`, not by asking
   the model nicely. A tool that trusts its own arguments is not a tool, it is
   a hole.

   The workspace is no longer frozen at boot. It starts where the process was
   launched — the app's own directory by default — and the reader can point it
   anywhere on the machine while the app is running, because a workspace you
   cannot choose is a workspace you cannot work in. The boundary moves; it never
   disappears.
   --------------------------------------------------------------------------- */

export const PORT = Number(process.env.LOONG_PORT ?? 5274)

/**
 * Which interface the agent listens on.
 *
 * Loopback by default, and that is not a detail. `serve()` without a hostname
 * binds every interface, so this process — which runs shell commands and writes
 * files — was reachable from the whole local network. The token only helped
 * when one was configured, and in dev there is none. `LOONG_HOST=0.0.0.0` still
 * works for an operator who wants that, but it is now a decision written down
 * rather than a default nobody chose.
 */
export const HOST = process.env.LOONG_HOST ?? '127.0.0.1'

/* NO default folder. A missing workspace used to fall back to `process.cwd()`,
   and the packaged app launched the sidecar with the user's whole home folder.
   That turned the boundary into the house instead of the room: a model asked to
   read "the folder I opened" happily read `Desktop/<project>/.agent-collab` and
   the agent's own source, because every one of them was inside the jail. The
   root is now chosen or there is no root, and `resolveInside` refuses. */
let workspaceRoot: string | null = process.env.LOONG_WORKSPACE
  ? resolve(process.env.LOONG_WORKSPACE)
  : null

/* A run carries its own root. Stored on the async context for the same reason
   the run id is: two threads on two different projects must not share one
   mutable boundary, and opening an old session must not inherit the folder the
   new one is pointed at. */
const runRoot = new AsyncLocalStorage<string>()

/** true when a folder has been chosen — file tools require it */
export function haveWorkspace(): boolean {
  return (runRoot.getStore() ?? workspaceRoot) !== null
}

/** the folder the agent may read and write, right now */
export function getWorkspace(): string {
  return runRoot.getStore() ?? workspaceRoot ?? process.cwd()
}

/**
 * Run everything this function awaits with a fixed root.
 *
 * Tool execution, leases, journal entries and hooks all resolve their paths
 * inside it, so a concurrent run on another project cannot observe or move it.
 */
export function withRunWorkspace<T>(root: string, fn: () => T): T {
  const abs = resolve(String(root ?? ''))
  if (!isAbsolute(abs)) throw new WorkspaceViolation(String(root ?? ''))
  return runRoot.run(abs, fn)
}

/** a file tool was asked to work before the reader chose a folder */
export class NoWorkspace extends Error {
  constructor() {
    super(
      'No folder is open. The agent reads and writes only inside a folder you choose — ' +
        'pick one from the composer before asking it to touch files.',
    )
    this.name = 'NoWorkspace'
  }
}

/** a path inside the boundary that is still none of the agent's business */
export class ProtectedPath extends Error {
  constructor(requested: string) {
    super(`Refused: "${requested}" is a protected path and is never read or written by the agent.`)
    this.name = 'ProtectedPath'
  }
}

/**
 * Point the agent at a different folder.
 *
 * Absolute paths only, resolved so a caller cannot sneak in `..`. Nothing is
 * created and nothing is deleted by this call — it repoints a boundary.
 */
export function setWorkspace(next: string): string {
  const trimmed = String(next ?? '').trim()
  if (!trimmed) throw new WorkspaceViolation(String(next ?? ''))
  const abs = resolve(trimmed)
  if (!isAbsolute(abs)) throw new WorkspaceViolation(trimmed)
  if (!existsSync(abs)) throw new WorkspaceViolation(trimmed)
  workspaceRoot = abs
  /* remembered, so a new window opens where the reader was working — not at
     the process folder, and not at home */
  try {
    writeFileSync(LAST_WORKSPACE_FILE, JSON.stringify({ workspace: abs }))
  } catch {
    /* a read-only data dir is not a reason to refuse the folder */
  }
  return abs
}

/* overridable so tests can point the journal at a throwaway directory — the
   default stays the user's real one */
export const DATA_DIR = process.env.LOONG_DATA_DIR ?? join(homedir(), '.loong')
export const DB_PATH = join(DATA_DIR, 'loong.db')
const LAST_WORKSPACE_FILE = join(DATA_DIR, 'workspace.json')

/* restore the folder the reader last opened, if it still exists */
if (!workspaceRoot) {
  try {
    const saved = JSON.parse(readFileSync(LAST_WORKSPACE_FILE, 'utf8')) as { workspace?: unknown }
    if (typeof saved.workspace === 'string' && existsSync(saved.workspace)) {
      workspaceRoot = resolve(saved.workspace)
    }
  } catch {
    /* first launch, or a folder that is gone — the picker will ask */
  }
}

/** never hand the model more than this from a single file */
export const MAX_READ_BYTES = 200_000
/**
 * A single tool call's answer to the model. This was 24,000 — six thousand
 * tokens per read — which is exactly how a small context window fills with
 * two file reads and refuses to write code. A read that needs more than this
 * is a read that should name a line range, so the note says so.
 */
export const MAX_OUTPUT_CHARS = 8_000
export const SHELL_TIMEOUT_MS = 60_000
export const FETCH_TIMEOUT_MS = 20_000
/** stop walking the tree after this many files */
export const MAX_WALK_FILES = 20_000
/** network calls made by the search tool */
export const SEARCH_TIMEOUT_MS = 12_000

/* ---------------------------------------------------------------------------
   Optional capabilities the reader turns on from Settings.

   These are not secrets except the two search keys, which follow the same
   rule as the model key: they live in the agent process, never in the UI.
   --------------------------------------------------------------------------- */

export interface Capabilities {
  /** let the agent drive a real browser (Edge/Chrome on this machine) */
  browser: boolean
  /** the security scan — semgrep, when it is installed */
  securityScan: boolean
  /** search the agent can actually read: Tavily → Brave → SearXNG → scrape */
  tavilyKey: string
  braveKey: string
  /** a self-hosted SearXNG base url, e.g. http://127.0.0.1:8888 */
  searxngUrl: string
  /** live library documentation — Context7. Optional: it works without a key
      at a lower rate; a key lifts the limit. */
  context7Key: string
}

const DEFAULT_CAPABILITIES: Capabilities = {
  browser: true,
  securityScan: true,
  tavilyKey: '',
  braveKey: '',
  searxngUrl: '',
  context7Key: '',
}

let capabilities: Capabilities = { ...DEFAULT_CAPABILITIES }

export function getCapabilities(): Capabilities {
  return capabilities
}

/** replace the capabilities; unknown keys keep their current value */
export function setCapabilities(next: Partial<Capabilities>): Capabilities {
  capabilities = { ...capabilities, ...next }
  return capabilities
}

export class WorkspaceViolation extends Error {
  constructor(requested: string) {
    super(
      `Refused: "${requested}" resolves outside the workspace (${getWorkspace()}). ` +
        `The agent may only touch files inside the workspace.`,
    )
    this.name = 'WorkspaceViolation'
  }
}

/**
 * Resolve a model-supplied path and refuse anything that escapes the workspace.
 *
 * Two checks, not one. The lexical check (does the normalised path sit under
 * the root?) is what most inputs need. The real check follows: the path is
 * resolved to its CANONICAL form with realpath, and that is what gets
 * validated — because a symlink inside the workspace can point anywhere on
 * the machine, and a check that stops at the lexical path is a check that a
 * link walks straight through. (This is the exact bug gemini-cli fixed in
 * their CLI: https://github.com/google-gemini/gemini-cli/issues/1121)
 *
 * The residual race — a link swapped between the check and the open — is the
 * price of a userspace sandbox. It needs a same-user attacker, and the window
 * is microseconds; the OS-level answer is containers, which is a different
 * product. Until then this is the strongest honest check.
 */
/* Folders that are never the agent's business, even when they sit inside the
   chosen folder. A home directory chosen as a workspace would otherwise expose
   `.agent-collab`, keys and cloud credentials by accident. */
const PROTECTED_SEGMENTS = new Set([
  '.agent-collab',
  '.ssh',
  '.aws',
  '.gnupg',
  '.password-store',
  '.kube',
  'credential-store',
])

function assertNotProtected(abs: string, requested: string): void {
  const rel = relative(workspaceReal(), abs)
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    if (PROTECTED_SEGMENTS.has(part.toLowerCase())) throw new ProtectedPath(requested)
  }
  /* the agent's own data folder — trust decisions, keys, the journal — is
     readable by the process, never by the model */
  try {
    const dataReal = realpathSync(DATA_DIR)
    const target = realpathOf(abs)
    if (target === dataReal || target.startsWith(dataReal + sep)) throw new ProtectedPath(requested)
  } catch (err) {
    if (err instanceof ProtectedPath) throw err
  }
}

export function resolveInside(requested: string): string {
  if (!haveWorkspace()) throw new NoWorkspace()

  /* A null byte is refused outright. `path.resolve` would happily normalise it
     away as an ordinary segment, but the syscall underneath truncates at it, so
     the path that was checked and the path that is opened would differ. That
     gap is the whole attack, so it never reaches the resolver. */
  if (requested.includes('\u0000')) throw new WorkspaceViolation(requested)

  const abs = isAbsolute(requested)
    ? resolve(requested)
    : resolve(getWorkspace(), requested)

  if (!isInside(abs)) throw new WorkspaceViolation(requested)

  /* the canonical form: symlinks resolved. For a path that does not exist yet
     (a file about to be written), the deepest existing ancestor is resolved
     and the new tail is re-attached — a new file cannot escape by existing. */
  const real = realpathOf(abs)
  if (!isInside(real)) throw new WorkspaceViolation(requested)
  assertNotProtected(real, requested)

  return abs
}

/** the workspace itself, canonical — OneDrive and junctions redirect silently */
function workspaceReal(): string {
  const root = runRoot.getStore() ?? workspaceRoot
  if (!root) return ''
  try {
    return realpathSync(root)
  } catch {
    return root
  }
}

/** realpath for a path that may not exist yet: resolve the deepest existing ancestor */
function realpathOf(abs: string): string {
  let current = abs
  const tail: string[] = []
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = realpathSync(current)
      return tail.length ? join(real, ...tail.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return abs
      tail.push(basename(current))
      current = parent
    }
  }
  return abs
}

/** True when an absolute path is inside the workspace — canonically, not just lexically. */
export function isInside(abs: string): boolean {
  const rel = relative(workspaceReal(), abs)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Show paths to the model as workspace-relative — absolute paths leak the machine. */
export function displayPath(abs: string): string {
  const rel = relative(getWorkspace(), abs)
  return rel === '' ? '.' : rel.replace(/\\/g, '/')
}

export function clip(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) return text
  const kept = text.slice(0, limit)
  const dropped = text.length - limit
  return `${kept}\n\n… truncated ${dropped.toLocaleString()} more characters. Narrow the request to see the rest.`
}
