import { tool } from 'ai'
import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, rm, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { searchHistory } from './history.ts'
import { addTimer, parseDelay } from './timers.ts'
import { learnSkill } from './skills.ts'
import { listTopics, readTopic, searchTopics } from './library.ts'
import { editManyTool, readManyTool, searchManyTool } from './tools-batch.ts'
import { dirname, join, relative } from 'node:path'
import {
  FETCH_TIMEOUT_MS,
  MAX_READ_BYTES,
  MAX_WALK_FILES,
  SEARCH_TIMEOUT_MS,
  SHELL_TIMEOUT_MS,
  clip,
  displayPath,
  getCapabilities,
  getWorkspace,
  resolveInside,
} from './config.ts'
import { requestApproval, requestQuestion } from './approvals.ts'
import { browserAction } from './browser.ts'
import { recordWrite } from './journal.ts'
import { forget, recall, remember } from './memory.ts'
import { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from './git.ts'
import { applyEdits, findMatch } from './edits.ts'

/** what a path holds right now — the before-state a rewind puts back */
function snapshot(abs: string): Buffer | null {
  try {
    return readFileSync(abs)
  } catch {
    return null
  }
}

const run = promisify(exec)

/* ---------------------------------------------------------------------------
   The tools.

   These are real. They touch the real filesystem, run real commands and make
   real network requests, which is exactly why three rules are enforced here
   rather than asked for in a prompt:

   1. Every path goes through `resolveInside`. The model cannot reach outside
      the workspace no matter what it writes in the arguments.
   2. Anything that mutates or executes is marked `needsApproval`, so the run
   stops and a human has to say yes. The interface has a gate for this; this
   is where it is enforced, not in the prompt.
   3. Network requests to private addresses are blocked at the tool level.
   --------------------------------------------------------------------------- */

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache', '.vite',
  '__pycache__', '.venv', 'target',
])

async function walk(root: string, limit = MAX_WALK_FILES) {
  const files: string[] = []
  const queue = [root]
  let truncated = false
  while (queue.length) {
    const dir = queue.shift()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (files.length >= limit) {
        truncated = true
        return { files, truncated }
      }
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
        queue.push(full)
      } else if (e.isFile()) {
        files.push(full)
      }
    }
  }
  return { files, truncated }
}

/* ---- ripgrep, when it is there ------------------------------------------- */

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
  cb: (err: Error | null, stdout: string) => void,
) => void

let execFileAsync: ExecFileLike | null = null
let ripgrepChecked = false
let ripgrepExists = false

/** rg lives on the PATH on most developer machines; ask once, remember */
function ripgrep(): ExecFileLike | null {
  if (!ripgrepChecked) {
    ripgrepChecked = true
    try {
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
      try {
        execFileSync(process.platform === 'win32' ? 'where' : 'which', ['rg'], {
          /* stdio:ignore silences the child; it does NOT hide the console
             window it opens. Without windowsHide every first grep flashed a
             console (Windows Terminal on Win11) — the "terminal opens and
             closes" the user kept seeing. */
          stdio: 'ignore',
          windowsHide: true,
        })
        ripgrepExists = true
      } catch {
        ripgrepExists = false
      }
    } catch {
      ripgrepExists = false
    }
  }
  if (!ripgrepExists) return null
  if (!execFileAsync) {
    const { execFile } = require('node:child_process') as typeof import('node:child_process')
    execFileAsync = execFile as unknown as ExecFileLike
  }
  return execFileAsync
}

/** run ripgrep and format its output the way the tool always returns it.
    Returns null when rg is unavailable or fails — the caller falls back. */
async function grepWithRipgrep(
  re: RegExp,
  root: string,
  glob: string | undefined,
  maxResults: number,
): Promise<string | null> {
  const execFile = ripgrep()
  if (!execFile) return null
  try {
    const args = [
      '--json',
      '--ignore-case',
      '--max-count',
      '1',
      '--max-filesize',
      '1M',
      re.source,
      root,
    ]
    const raw = await new Promise<string>((resolve) => {
      execFile('rg', args, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (_err, stdout) =>
        resolve(stdout ?? ''),
      )
    })
    if (!raw) return null
    const hits: { file: string; line: number; text: string }[] = []
    for (const row of raw.split('\n')) {
      if (!row) continue
      let parsed: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } }
      try {
        parsed = JSON.parse(row)
      } catch {
        continue
      }
      if (parsed.type !== 'match') continue
      const file = parsed.data?.path?.text ?? ''
      const text = (parsed.data?.lines?.text ?? '').replace(/\n$/, '').trim().slice(0, 200)
      const line = parsed.data?.line_number ?? 0
      if (glob && !file.includes(glob)) continue
      hits.push({ file: displayPath(file), line, text })
      if (hits.length >= maxResults) break
    }
    if (hits.length === 0) {
      return `No matches for /${re.source}/i in ${displayPath(root)}.`
    }
    const body = hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')
    return `${hits.length} matches in ${displayPath(root)} (ripgrep):\n\n${clip(body)}`
  } catch {
    return null
  }
}

export const listDir = tool({
  description: 'List the entries in a directory inside the workspace. Use this first when you need to know what a project contains.',
  inputSchema: z.object({
    path: z.string().describe('Directory path, relative to the workspace root. Use "." for the root.'),
  }),
  execute: async ({ path }) => {
    const abs = resolveInside(path)
    const entries = await readdir(abs, { withFileTypes: true })
    const rows = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .slice(0, 400)
        .map(async (e) => {
          if (e.isDirectory()) return `${e.name}/`
          try {
            const s = await stat(join(abs, e.name))
            return `${e.name}  ${s.size} B`
          } catch {
            return e.name
          }
        }),
    )
    if (rows.length === 0) return `${displayPath(abs)} is empty.`
    return `${displayPath(abs)}/\n${rows.join('\n')}`
  },
})

export const readFileTool = tool({
  description: 'Read a text file inside the workspace. Returns the contents with line numbers so you can refer to exact lines.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root.'),
    startLine: z.number().int().min(1).optional().describe('First line to read, 1-based.'),
    endLine: z.number().int().min(1).optional().describe('Last line to read, inclusive.'),
  }),
  execute: async ({ path, startLine, endLine }) => {
    const abs = resolveInside(path)
    const s = await stat(abs)
    if (s.size > MAX_READ_BYTES * 5) {
      return `Refused: ${displayPath(abs)} is ${(s.size / 1e6).toFixed(1)} MB. Read a line range instead.`
    }
    const raw = await readFile(abs, 'utf8')
    const lines = raw.split('\n')
    const from = Math.max(1, startLine ?? 1)
    const to = Math.min(lines.length, endLine ?? lines.length)
    const slice = lines.slice(from - 1, to)
    const width = String(to).length
    const body = slice.map((l, i) => `${String(from + i).padStart(width, ' ')}  ${l}`).join('\n')
    const header = `${displayPath(abs)}  (lines ${from}-${to} of ${lines.length})\n`
    return clip(header + body)
  },
})

export const grepTool = tool({
  description: 'Search file contents across the workspace with a regular expression. Returns matching lines with their file and line number. Use this to find where something is defined or used.',
  inputSchema: z.object({
    pattern: z.string().describe('A JavaScript regular expression, case-insensitive.'),
    path: z.string().optional().describe('Directory to search. Defaults to the workspace root.'),
    glob: z.string().optional().describe('Only search files whose path contains this substring, e.g. ".ts".'),
    maxResults: z.number().int().min(1).max(400).optional(),
  }),
  execute: async ({ pattern, path, glob, maxResults = 120 }) => {
    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch (err) {
      return `Refused: "${pattern}" is not a valid regular expression. ${(err as Error).message}`
    }
    const root = resolveInside(path ?? '.')

    /* ripgrep when the machine has it: the same search, 10-50x faster, and it
       respects .gitignore by default — the tree a reader expects. The Node walk
       below is the portable fallback, not the fast path. */
    const fast = await grepWithRipgrep(re, root, glob, maxResults)
    if (fast !== null) return fast

    const { files, truncated } = await walk(root)
    const hits: string[] = []
    let scanned = 0
    for (const file of files) {
      if (hits.length >= maxResults) break
      if (glob && !file.includes(glob)) continue
      try {
        const s = await stat(file)
        if (s.size > MAX_READ_BYTES) continue
        const text = await readFile(file, 'utf8')
        if (text.includes('\0')) continue
        scanned++
        const lines = text.split('\n')
        for (let i = 0; i < lines.length && hits.length < maxResults; i++) {
          if (re.test(lines[i])) {
            hits.push(`${displayPath(file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
          }
        }
      } catch {}
    }
    if (hits.length === 0) {
      return `No matches for /${pattern}/i in ${displayPath(root)} (${scanned} files scanned).`
    }
    const note = truncated ? '\n(tree walk hit its file limit)' : ''
    return clip(`${hits.length} matches in ${displayPath(root)}:\n\n${hits.join('\n')}${note}`)
  },
})

export const writeFileTool = tool({
  description: 'Create or overwrite a text file inside the workspace. Requires human approval before it runs.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root.'),
    content: z.string().describe('The complete new contents of the file.'),
  }),
  execute: async ({ path, content }) => {
    const abs = resolveInside(path)
    await mkdir(dirname(abs), { recursive: true })
    let previous: Buffer | null = null
    try {
      previous = await readFile(abs)
    } catch {}
    await writeFile(abs, content, 'utf8')
    /* the before-state is what makes an undo possible — stored binary-safe */
    recordWrite('write', abs, previous)
    const verb = previous ? 'Overwrote' : 'Created'
    return `${verb} ${displayPath(abs)} — ${content.length} characters, ${content.split('\n').length} lines.`
  },
})

export const editFileTool = tool({
  description:
    'Edit a text file by replacing an exact substring. The text must match exactly once in the file; if it matches more than once the edit is refused with the line numbers of every match, so include more context. Requires human approval before it runs.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root.'),
    oldText: z.string().describe('Exact text to replace, as it appears in the file.'),
    newText: z.string().describe('Replacement text.'),
  }),
  execute: async ({ path, oldText, newText }) => {
    const abs = resolveInside(path)
    const raw = await readFile(abs, 'utf8')
    const match = findMatch(raw, oldText)
    if (match.kind === 'many') {
      return `Refused: that text appears ${match.lines.length} times (lines ${match.lines.join(', ')}). Add more surrounding context so it matches exactly once, then retry.`
    }
    if (match.kind === 'none') {
      return `Refused: ${match.hint}`
    }
    const updated =
      raw.slice(0, match.start) + newText + raw.slice(match.end)
    await writeFile(abs, updated, 'utf8')
    recordWrite('write', abs, raw)
    /* what landed, in context — the model sees the result instead of
       assuming it, which is what stops a blind retry */
    const region = regionAround(updated, match.start, newText.length)
    const note = match.note ? ` (${match.note})` : ''
    return `Edited ${displayPath(abs)}${note}. The file now reads:\n${region}`
  },
})

/**
 * The lines around a change, numbered — enough for the model to see what the
 * edit actually produced without re-reading the whole file.
 */
function regionAround(content: string, start: number, length: number): string {
  const before = content.slice(0, start).split('\n').length
  const after = content.slice(0, start + length).split('\n').length
  const first = Math.max(1, before - 2)
  const last = Math.min(content.split('\n').length, after + 2)
  const lines = content.split('\n')
  const out: string[] = []
  for (let i = first; i <= last; i++) {
    out.push(`${String(i).padStart(4)} │ ${lines[i - 1] ?? ''}`)
  }
  return out.join('\n')
}

export const multiEditTool = tool({
  description:
    'Apply several exact-string edits to one file in a single call. Every edit is validated first: if any one fails, NONE of them are applied. Each oldText must match exactly once. Use this instead of many edit_file calls. Requires human approval before it runs.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to the workspace root.'),
    edits: z
      .array(
        z.object({
          oldText: z.string().describe('Exact text to replace, as it appears in the file.'),
          newText: z.string().describe('Replacement text.'),
        }),
      )
      .min(1)
      .describe('The edits, in order.'),
  }),
  execute: async ({ path, edits }) => {
    const abs = resolveInside(path)
    const raw = await readFile(abs, 'utf8')
    const result = applyEdits(raw, edits)
    if (!result.ok) {
      return `Refused — nothing was changed: ${result.error}`
    }
    await writeFile(abs, result.content, 'utf8')
    recordWrite('write', abs, raw)
    const notes = result.notes.length > 0 ? ` (${result.notes.join('; ')})` : ''
    return `Applied ${result.applied} edit${result.applied === 1 ? '' : 's'} to ${displayPath(abs)}${notes}.`
  },
})

export const mkdirTool = tool({
  description: 'Create a directory (and parents) inside the workspace. Requires human approval before it runs.',
  inputSchema: z.object({
    path: z.string().describe('Directory path relative to the workspace root.'),
  }),
  execute: async ({ path }) => {
    const abs = resolveInside(path)
    await mkdir(abs, { recursive: true })
    recordWrite('mkdir', abs, null)
    return `Created directory ${displayPath(abs)}.`
  },
})

export const deleteFileTool = tool({
  description: 'Delete a file or directory inside the workspace. Requires human approval before it runs.',
  inputSchema: z.object({
    path: z.string().describe('Path relative to the workspace root.'),
  }),
  execute: async ({ path }) => {
    const abs = resolveInside(path)
    await rm(abs, { recursive: true, force: true })
    recordWrite('delete', abs, snapshot(abs))
    return `Deleted ${displayPath(abs)}.`
  },
})

export const moveFileTool = tool({
  description: 'Move or rename a file or directory inside the workspace. Requires human approval before it runs.',
  inputSchema: z.object({
    from: z.string().describe('Source path relative to the workspace root.'),
    to: z.string().describe('Destination path relative to the workspace root.'),
  }),
  execute: async ({ from, to }) => {
    const absFrom = resolveInside(from)
    const absTo = resolveInside(to)
    await mkdir(dirname(absTo), { recursive: true })
    const before = snapshot(absFrom)
    await rename(absFrom, absTo)
    /* two entries, because a move is a delete plus a create — and a rewind
       runs backwards, putting each half back in the right order */
    recordWrite('move', absFrom, before)
    recordWrite('move', absTo, null)
    return `Moved ${displayPath(absFrom)} to ${displayPath(absTo)}.`
  },
})

export const shellTool = tool({
  description:
    'Run a shell command in the workspace and return its combined output. On Windows this is cmd.exe: use cmd syntax (cd /d, %VAR%, dir) — pwd, ls, $VAR and /dev/null do not exist there. The working directory does NOT persist between calls: pass cwd every time you need a folder, or chain with &&. Requires human approval before it runs.',
  inputSchema: z.object({
    command: z.string().describe('The command to run, e.g. "npm test" or "git status".'),
    cwd: z.string().optional().describe('Directory to run in, relative to the workspace root.'),
  }),
  execute: async ({ command, cwd }) => {
    const dir = resolveInside(cwd ?? '.')
    try {
      const { stdout, stderr } = await run(command, {
        cwd: dir,
        timeout: SHELL_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      })
      const out = [stdout, stderr].filter(Boolean).join('\n').trim()
      /* where it actually ran, echoed back — a model that assumes the cwd
         is what produces the same `cd x && echo test` command fifteen times */
      return `${clip(out || '(the command produced no output)')}\n[cwd: ${displayPath(dir)}]`
    } catch (err) {
      const e = err as Error & { killed?: boolean; stdout?: string; stderr?: string }
      if (e.killed) {
        return `The command was killed after ${SHELL_TIMEOUT_MS / 1e3}s.\n${clip(e.stdout ?? '')}\n[cwd: ${displayPath(dir)}]`
      }
      const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
      const looksBash = process.platform === 'win32' && /pwd|ls -|ls\b|\$[A-Za-z_]|\/dev\/null|~\/|export [A-Za-z_]+=/.test(command)
      const hint = looksBash
        ? `\n[hint: this shell is cmd.exe on Windows — pwd, ls, $VAR, ~/, export and /dev/null are bash-isms. Use dir, cd /d, %VAR%, or chain commands with &&.]`
        : ''
      return clip(`Command failed.\n${out || e.message}${hint}`) + `\n[cwd: ${displayPath(dir)}]`
    }
  },
})

/* ---------------------------------------------------------------------------
   Network egress, one guarded door.

   `fetch` with `redirect: 'follow'` will happily walk a public URL to
   169.254.169.254 or 127.0.0.1 if the server answers with aLocation header —
   the check on the first URL says nothing about the tenth. So redirects are
   followed BY HAND here, one hop at a time, and every hop goes through the
   same isBlockedHost / isBlockedIp gate as the original request. DNS is
   re-resolved per hop, which is also the only defence against a name that
   answers public once and private later.
   --------------------------------------------------------------------------- */

const MAX_REDIRECTS = 3

async function guardUrl(parsed: URL): Promise<void> {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refused: only http and https are allowed, got ${parsed.protocol}`)
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Refused: "${parsed.hostname}" is an internal address.`)
  }
  const resolved = await lookup(parsed.hostname).catch(() => null)
  if (resolved && isBlockedIp(resolved.address)) {
    throw new Error(`Refused: "${parsed.hostname}" resolves to an internal address.`)
  }
}

/** fetch a public URL, re-validating every hop. Throws with a "Refused:" message on a blocked destination. */
async function safeFetch(url: string, headers: Record<string, string>): Promise<Response> {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      throw new Error(`Refused: "${target}" is not a valid URL.`)
    }
    await guardUrl(parsed)
    const rec = await lookup(parsed.hostname).catch(() => null)
    if (!rec) throw new Error(`Refused: cannot resolve "${parsed.hostname}".`)
    /* Pin the connection to the exact address we just validated. Without this,
       fetch would re-resolve DNS at connect time, leaving a window where a
       malicious name answers public to the check and private to the real
       connection — a classic DNS-rebinding hole. The lookup callback ignores
       the hostname and returns the validated address. */
    const { Agent } = await import('undici')
    const dispatcher = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, rec.address, rec.family ?? 4) },
    })
    const init: Record<string, unknown> = {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'manual',
      dispatcher,
    }
    const res = (await fetch(parsed, init as unknown as RequestInit)) as Response
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`Refused: redirect with no destination (${res.status}).`)
      target = new URL(location, parsed).href
      continue
    }
    return res
  }
  throw new Error(`Refused: more than ${MAX_REDIRECTS} redirects.`)
}

export const fetchTool = tool({
  description: 'Fetch a URL and return its text. Use this to read documentation or a public API response.',
  inputSchema: z.object({
    url: z.string().describe('An absolute http or https URL.'),
  }),
  execute: async ({ url }) => {
    try {
      const res = await safeFetch(url, { 'user-agent': SEARCH_UA })
      const MAX_FETCH_BYTES = 1e6
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length > MAX_FETCH_BYTES) {
        return `Refused: response is ${(buf.length / 1e6).toFixed(1)} MB, over the 1 MB limit. Narrow the request.`
      }
      const text = new TextDecoder().decode(buf)
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
      return clip(`${res.status} ${new URL(url).hostname}\n\n${stripped.trim()}`)
    } catch (err) {
      const message = (err as Error).message
      return message.startsWith('Refused:') ? message : `Fetch failed: ${message}`
    }
  },
})

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true
  }
  if (h === 'metadata.google.internal' || h === 'metadata.google' || h === 'instance-data') {
    return true
  }
  return isBlockedIp(h)
}

function isBlockedIp(ip: string): boolean {
  if (ip === '::1' || ip === '::' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) {
    return true
  }
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [, aS, bS, cS, dS] = m
  const a = Number(aS), b = Number(bS), c = Number(cS), d = Number(dS)
  if ([a, b, c, d].some((n) => n > 255)) return false
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0 || a >= 224) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && (b === 0 || b === 18 || b === 19)) return true
  if (a === 198 && (b === 18 || b === 19 || b >= 51 && b <= 55)) return true
  if (a === 203 && b === 0 && c === 113) return true
  return false
}

const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

/* ---------------------------------------------------------------------------
   Web search, four ways deep.

   The old version scraped DuckDuckGo's HTML page with a regex. It worked,
   until it didn't: throttling, or an HTML change, and the agent searched the
   web without seeing the result — which reads exactly like a broken tool.

   Now the chain is: Tavily (built for LLMs, returns real content) → Brave
   (clean JSON, free tier) → SearXNG (self-hosted, no key at all) → the old
   scrape as the last resort. Whichever answers, the top result's page is
   fetched and its text comes back with the links, because a title and a
   snippet is not an answer.
   --------------------------------------------------------------------------- */

interface SearchRow {
  title: string
  url: string
  snippet: string
}

async function searchTavily(query: string, key: string, max: number): Promise<SearchRow[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: max,
      search_depth: 'basic',
      include_answer: false,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`tavily ${res.status}`)
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[]
  }
  return (body.results ?? []).map((r) => ({
    title: r.title ?? '(untitled)',
    url: r.url ?? '',
    snippet: (r.content ?? '').slice(0, 300),
  }))
}

async function searchBrave(query: string, key: string, max: number): Promise<SearchRow[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`,
    {
      headers: { accept: 'application/json', 'X-Subscription-Token': key },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`brave ${res.status}`)
  const body = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] }
  }
  return (body.web?.results ?? []).map((r) => ({
    title: r.title ?? '(untitled)',
    url: r.url ?? '',
    snippet: (r.description ?? '').slice(0, 300),
  }))
}

async function searchSearxng(query: string, base: string, max: number): Promise<SearchRow[]> {
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&language=en`
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`searxng ${res.status}`)
  const body = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[]
  }
  return (body.results ?? []).slice(0, max).map((r) => ({
    title: r.title ?? '(untitled)',
    url: r.url ?? '',
    snippet: (r.content ?? '').slice(0, 300),
  }))
}

async function searchScrape(query: string, max: number): Promise<SearchRow[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'user-agent': SEARCH_UA },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    redirect: 'manual',
  })
  if (res.status >= 300) throw new Error(`duckduckgo ${res.status}`)
  const html = await res.text()
  const rows: SearchRow[] = []
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && rows.length < max) {
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    const uddg = m[1].match(/uddg=([^&]+)/)
    let url: string
    try {
      url = uddg ? decodeURIComponent(uddg[1]) : new URL(m[1], 'https://duckduckgo.com').href
    } catch {
      continue
    }
    const block = html.slice(m.index, m.index + 2000)
    const sm = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    const snippet = sm
      ? sm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim()
      : ''
    rows.push({ title, url, snippet })
  }
  return rows
}

/** pull the readable text out of one page, so the model reads more than a link */
async function readTopResult(url: string): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  try {
    /* the same guarded door as fetch_url — a search result is an untrusted URL
       like any other, and following it blind is how an agent is walked onto a
       private network */
    const res = await safeFetch(url, { 'user-agent': SEARCH_UA })
    if (!res.ok) return ''
    const text = await res.text()
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return clip(stripped, 3_000)
  } catch {
    return ''
  }
}

export const webSearchTool = tool({
  description:
    'Search the web and return real results: titles, URLs, snippets, and the text of the top result. Use this when you need a library API, an error message, or any fact you do not already have. Prefer this over guessing.',
  inputSchema: z.object({
    query: z.string().describe('What to search for. Plain words, not a URL.'),
    maxResults: z.number().int().min(1).max(10).optional().describe('How many results to bring back. Default 5.'),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    const q = query.trim()
    if (!q) return 'Refused: the query is empty.'
    const caps = getCapabilities()
    const attempts: { name: string; run: () => Promise<SearchRow[]> }[] = []
    if (caps.tavilyKey) attempts.push({ name: 'tavily', run: () => searchTavily(q, caps.tavilyKey, maxResults) })
    if (caps.braveKey) attempts.push({ name: 'brave', run: () => searchBrave(q, caps.braveKey, maxResults) })
    if (caps.searxngUrl)
      attempts.push({ name: 'searxng', run: () => searchSearxng(q, caps.searxngUrl, maxResults) })
    attempts.push({ name: 'duckduckgo', run: () => searchScrape(q, maxResults) })

    let rows: SearchRow[] = []
    let used = 'none'
    const failures: string[] = []
    for (const attempt of attempts) {
      try {
        rows = await attempt.run()
        used = attempt.name
        if (rows.length > 0) break
      } catch (err) {
        failures.push(`${attempt.name}: ${(err as Error).message}`)
      }
    }
    if (rows.length === 0) {
      return `No results for "${q}" (tried ${failures.join('; ') || used}). Try different words, or fetch a known URL.`
    }

    const list = rows
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
      .join('\n\n')
    /* the top result, read — the difference between searching and finding */
    const top = rows[0].url
    const page = await readTopResult(top)
    const parts = [`${rows.length} results for "${q}" (via ${used}):\n\n${list}`]
    if (page) {
      parts.push(`\n\n--- Top result, read: ${top} ---\n${page}`)
    }
    if (rows.length < 3) {
      parts.push('\n\n(few results — the phrasing may be too specific)')
    }
    return clip(parts.join(''))
  },
})

/* ---------------------------------------------------------------------------
   Per-run tools. These are created fresh for each agent run because they
   close over the run's identity (for the approval/question broker).
   --------------------------------------------------------------------------- */

export function createAskUserTool(runId: string) {
  return tool({
    description: 'Ask the user a question and wait for their answer. Use this the moment a task has more than one reasonable reading — do not guess and do not pick the most likely one. The run pauses and the answer comes back as your tool result.',
    inputSchema: z.object({
      question: z.string().describe('The question, in one sentence. Be specific.'),
      detail: z.string().optional().describe('Why this matters, or what the options would each lead to.'),
      options: z.array(z.string()).max(5).optional().describe('Up to five suggested answers, offered as shortcuts.'),
    }),
    execute: async ({ question, detail, options }) => {
      const answer = await requestQuestion(runId, { question, detail, options })
      if (answer === null) {
        return 'The user did not answer in time. Do not continue on an assumption — state plainly what you were going to do and why you need the answer, then stop.'
      }
      return `The user answered: ${answer}`
    },
  })
}

export interface Plan {
  task: string
  steps: { description: string; status: 'pending' | 'in_progress' | 'done' | 'blocked' }[]
  updatedAt: number
  /** the bar this work is measured against */
  reference?: string
  /** concrete acceptance criteria, decided before the work */
  doneWhen?: string[]
}

export interface Audit {
  verdict: 'met' | 'partial' | 'not_met'
  items: { criterion: string; met: boolean; evidence: string }[]
  note?: string
}

export function createPlanTool(onPlan: (plan: Plan) => void) {
  return tool({
    description:
      'Write the plan for the current task, as an ordered list of steps. Call this once at the start of any job with more than one step, then again whenever it changes. Name the reference you are aiming at and the criteria that will prove the work is done — the user sees all of it live.',
    inputSchema: z.object({
      task: z.string().describe("One line: what is being done, in the user's words if possible."),
      reference: z
        .string()
        .optional()
        .describe(
          'The bar this work is measured against: a named product, pattern, doc or spec. Aim at it on the first attempt — a prototype is a failure.',
        ),
      done_when: z
        .array(z.string())
        .max(12)
        .optional()
        .describe(
          'Concrete acceptance criteria. Each must be provable with a file, a test, a command or a screenshot.',
        ),
      steps: z.array(
        z.object({
          description: z.string().describe('One concrete, verifiable step.'),
          status: z.enum(['pending', 'in_progress', 'done', 'blocked']).describe('Where this step stands right now.'),
        }),
      )
        .min(1)
        .max(24)
        .describe('The whole list, every time. Not just what changed.'),
    }),
    execute: async ({ task, reference, done_when, steps }) => {
      const plan: Plan = {
        task,
        steps: steps.map((s) => ({ ...s })),
        updatedAt: Date.now(),
        ...(reference?.trim() ? { reference: reference.trim() } : {}),
        ...(done_when?.length
          ? { doneWhen: done_when.map((s) => s.trim()).filter(Boolean) }
          : {}),
      }
      onPlan(plan)
      const ref = plan.reference ? ` Reference: ${plan.reference}.` : ''
      const criteria = plan.doneWhen?.length
        ? ` ${plan.doneWhen.length} acceptance criteria.`
        : ''
      return `Plan saved with ${plan.steps.length} step(s). ${plan.steps.filter((s) => s.status === 'done').length} done.${ref}${criteria} The user can see it.`
    },
  })
}

/**
 * The last thing before "done".
 *
 * An agent can say it finished; an audit says what proves it. The tool is
 * deliberately narrow: one row per criterion it committed to, met or not, with
 * the evidence. If anything is unmet the result tells it to keep working —
 * the claim and the evidence are not allowed to drift apart.
 */
export function createAuditTool(onAudit: (audit: Audit) => void) {
  return tool({
    description:
      'Call this before you say a job is done. One row per acceptance criterion: met or not, and the evidence (a file, a test result, a command, a screenshot). If anything is not met, do not claim the job is done.',
    inputSchema: z.object({
      verdict: z.enum(['met', 'partial', 'not_met']).describe('The honest overall verdict.'),
      items: z
        .array(
          z.object({
            criterion: z.string().describe('One criterion you committed to.'),
            met: z.boolean().describe('True only if the evidence exists right now.'),
            evidence: z
              .string()
              .describe('The file, test, command output or screenshot that proves it.'),
          }),
        )
        .min(1)
        .max(16),
      note: z.string().optional().describe('What is left, if anything.'),
    }),
    execute: async ({ verdict, items, note }) => {
      onAudit({ verdict, items, ...(note ? { note } : {}) })
      const unmet = items.filter((i) => !i.met)
      if (unmet.length === 0 && verdict === 'met') {
        return `Audit recorded: ${items.length} criterion/criteria, all with evidence. You may say the job is done.`
      }
      return `Audit recorded: ${unmet.length} criterion/criteria not met. Do not claim the job is done — finish them or say plainly what is missing.`
    },
  })
}

export function createProposeChangesTool(runId: string, autoApprove = false) {
  return tool({
    description: 'Propose a set of new or rewritten files and submit them for one approval. Use this when a change spans several files: the user reviews the whole set at once instead of file by file. Nothing is written until they say yes.',
    inputSchema: z.object({
      summary: z.string().describe('One line describing the whole change.'),
      files: z.array(
        z.object({
          path: z.string().describe('Path relative to the workspace root.'),
          content: z.string().describe('The complete new contents of this file.'),
        }),
      )
        .min(1)
        .max(20)
        .describe('Every file in the set, with its full new contents.'),
    }),
    execute: async ({ summary, files }) => {
      const resolved = files.map((f) => ({
        path: f.path,
        content: f.content,
        abs: resolveInside(f.path),
        before: snapshot(resolveInside(f.path)),
      }))
      const lines = resolved.map((f) => `  ${f.path}  —  ${f.content.split('\n').length} lines, ${f.content.length} chars`).join('\n')
      /* the structured before/after travels with the approval so the interface
         can render a real diff, not prose describing one */
      const diff = resolved.map((f) => ({
        path: f.path,
        before: f.before ? f.before.slice(0, 8_000) : null,
        after: f.content.slice(0, 8_000),
      }))
      /* full trust means this whole set lands without a prompt */
      const approved = autoApprove
        ? true
        : await requestApproval(runId, {
            tool: 'propose_changes',
            title: summary,
            detail: `${resolved.length} file(s) will be written:\n${lines}`,
            payload: { files: resolved.map((f) => ({ path: f.path })), diff },
          })
      if (!approved) {
        return 'The user declined the whole set. Do not write any of these files and do not retry them one at a time. Say what you would have changed and stop.'
      }
      const written: string[] = []
      for (const f of resolved) {
        await mkdir(dirname(f.abs), { recursive: true })
        await writeFile(f.abs, f.content, 'utf8')
        recordWrite('write', f.abs, f.before)
        written.push(`${displayPath(f.abs)} (${f.content.split('\n').length} lines)`)
      }
      return `Wrote ${written.length} file(s):\n${written.map((w) => `  ${w}`).join('\n')}`
    },
  })
}

/* ---------------------------------------------------------------------------
   The static tool table. These are the tools that exist for every run; the
   per-run tools are added in agent.ts.
   --------------------------------------------------------------------------- */

/* ---- live library documentation (Context7, without an MCP server) -------- */

export const libraryDocsTool = tool({
  description:
    'Fetch the CURRENT documentation and code examples for a library or framework by name (e.g. "react", "next.js", "vite"). Use this before writing any code against a library you are not certain about — your memory of an API is older than its current docs. Returns real docs and snippets, not guesses.',
  inputSchema: z.object({
    library: z.string().describe('Library or framework name, e.g. "react", "tailwindcss", "hono".'),
    topic: z
      .string()
      .optional()
      .describe('Narrow it: the feature you care about, e.g. "streaming", "routing".'),
    tokens: z
      .number()
      .int()
      .min(500)
      .max(20000)
      .optional()
      .describe('How much documentation to bring back. Default 4000.'),
  }),
  execute: async ({ library, topic, tokens = 4000 }) => {
    const caps = getCapabilities()
    const key = caps.context7Key
    const headers: Record<string, string> = { accept: 'application/json' }
    if (key) headers['authorization'] = `Bearer ${key}`
    const searchUrl =
      `https://context7.com/api/v1/search?query=${encodeURIComponent(library.trim())}`
    let projectId = ''
    try {
      const res = await fetch(searchUrl, {
        headers,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      })
      if (!res.ok) return `Context7 answered ${res.status}. Fall back to web_search for "${library}" docs.`
      const body = (await res.json()) as {
        results?: { id?: string; title?: string; description?: string }[]
      }
      const best = (body.results ?? []).find((r) =>
        r.title?.toLowerCase().includes(library.toLowerCase()),
      ) ?? (body.results ?? [])[0]
      projectId = best?.id ?? ''
      if (!projectId) {
        return `No live docs for "${library}". Use web_search, and say the docs were not found.`
      }
    } catch (err) {
      return `Context7 failed: ${(err as Error).message}. Use web_search instead.`
    }
    try {
      const docsUrl = new URL(`https://context7.com/api/v1/${projectId}`)
      if (topic) docsUrl.searchParams.set('topic', topic)
      docsUrl.searchParams.set('tokens', String(tokens))
      docsUrl.searchParams.set('format', 'txt')
      const res = await fetch(docsUrl, {
        headers: { ...headers, accept: 'text/plain' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return `Context7 docs answered ${res.status} for ${projectId}.`
      const text = await res.text()
      if (!text.trim()) return `No docs text for "${library}" (${projectId}).`
      return clip(text.trim())
    } catch (err) {
      return `Context7 docs failed: ${(err as Error).message}`
    }
  },
})

/* ---- deliberate thinking, one step at a time ---------------------------- */

export const thinkingTool = tool({
  description:
    'Think through a problem one step at a time, on the record. Use it whenever the next move is not obvious: state this step, what it assumes, and what comes next. Each call adds one step; the user watches the reasoning happen. It changes nothing on disk — it is for thinking, not acting.',
  inputSchema: z.object({
    thought: z.string().describe('This step, in full sentences. What you know, what follows from it.'),
    nextThoughtNeeded: z
      .boolean()
      .describe('True if another step is needed before acting. False when the thinking is done and you are ready to act.'),
  }),
  execute: async ({ thought, nextThoughtNeeded }) => {
    /* the tool is intentionally stateless: its whole job is to make the model
       write the step down before it acts, which is what " rushing" prevents */
    const tail = nextThoughtNeeded
      ? 'Continue with the next thought, then act.'
      : 'Reasoning complete — act on it now.'
    return `Step recorded.\n\n${thought.trim()}\n\n${tail}`
  },
})

/* ---- read a document (PDF/Office) as text -------------------------------- */

export const readDocumentTool = tool({
  description:
    'Convert a document — PDF, DOCX, XLSX, PPTX, HTML — into plain text you can read. Use it for a spec, a report, or data the user attached. Requires markitdown to be installed on this machine (pip install markitdown).',
  inputSchema: z.object({
    path: z.string().describe('Path to the document, relative to the workspace root.'),
  }),
  execute: async ({ path }) => {
    const abs = resolveInside(path)
    try {
      const { execFile } = await import('node:child_process')
      const out = await new Promise<string>((resolve) => {
        execFile(
          'markitdown',
          [abs],
          { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
          (_err, stdout) => resolve(stdout ?? ''),
        )
      })
      if (!out.trim()) {
        return `markitdown produced nothing — it may not be installed. Ask the user: install it with "pip install markitdown" (or "uv tool install markitdown"), then retry.`
      }
      return clip(out.trim())
    } catch {
      return `markitdown is not available. Ask the user to install it ("pip install markitdown"), or fetch a text/HTML version of the document instead.`
    }
  },
})

/* ---- the eyes: a real browser ------------------------------------------- */

export const browserTool = tool({
  description:
    'Drive a real browser (Edge or Chrome on this machine) and read the page as text. "open" loads a URL and returns its control tree and console errors; "snapshot" re-reads the current page; "screenshot" saves a PNG the user can see; "click"/"type"/"evaluate" act on it. Use this to run the app you just built and confirm it actually works — read the console errors, do not guess.',
  inputSchema: z.object({
    action: z
      .enum(['open', 'snapshot', 'screenshot', 'click', 'type', 'evaluate', 'close'])
      .describe('What to do.'),
    argument: z
      .string()
      .describe('The URL for open; a CSS selector for click/type ("selector || text"); JS for evaluate; "full" for a full-page screenshot.'),
  }),
  execute: async ({ action, argument }) => {
    if (!getCapabilities().browser) {
      return 'The browser tool is switched off in Settings.'
    }
    try {
      const out = await browserAction(action, argument)
      /* the marker is how the run loop learns a screenshot exists so it can
         show the reader; it is stripped before the model sees the text */
      const marker = out.shot ? `\nSHOT:${out.shot}` : ''
      return out.text + marker
    } catch (err) {
      return `Browser failed: ${(err as Error).message}`
    }
  },
})

/* ---- the eyes: reading an image ----------------------------------------- */

export const readImageTool = tool({
  description:
    'Read an image file (a screenshot you took, a mockup, an error dialog the user mentioned) and actually look at it. Returns the image to you — you will see it, describe what you see, and act on it. Only vision-capable models can use this.',
  inputSchema: z.object({
    path: z.string().describe('Path to a PNG/JPG/GIF/WebP, relative to the workspace root.'),
  }),
  execute: async ({ path }) => {
    try {
      const abs = resolveInside(path)
      const data = readFileSync(abs)
      if (data.length > 8 * 1024 * 1024) return `Refused: the image is ${(data.length / 1e6).toFixed(1)} MB.`
      return { shotBase64: data.toString('base64'), shot: abs }
    } catch (err) {
      return `Could not read image: ${(err as Error).message}`
    }
  },
  /* the model sees the picture, not a description of it */
  toModelOutput({ output }) {
    if (typeof output === 'string') return { type: 'content', value: [{ type: 'text', text: output }] }
    const o = output as { shotBase64?: string }
    if (!o.shotBase64) {
      return { type: 'content', value: [{ type: 'text', text: 'The image could not be read.' }] }
    }
    return {
      type: 'content',
      value: [
        { type: 'file', mediaType: 'image/png', data: { type: 'data', data: o.shotBase64 } },
      ],
    } as never
  },
})

/* ---- verification: prove it works --------------------------------------- */

export const verifyTool = tool({
  description:
    'Run this project\'s own checks — typecheck, tests, build — and return the raw output. Call it after every change you make to the code: an edit you have not run is a claim, not a change. Requires human approval because it executes commands.',
  inputSchema: z.object({
    what: z
      .enum(['auto', 'typecheck', 'test', 'build'])
      .optional()
      .describe('Which check to run. "auto" picks what the project has. Default auto.'),
  }),
  execute: async ({ what = 'auto' }) => {
    const ws = getWorkspace()
    const has = (f: string) => existsSync(join(ws, f))
    const inPkg = (script: string): boolean => {
      try {
        const pkg = JSON.parse(readFileSync(join(ws, 'package.json'), 'utf8')) as {
          scripts?: Record<string, string>
        }
        return Boolean(pkg.scripts?.[script])
      } catch {
        return false
      }
    }

    const commands: [string, string][] = []
    const push = (label: string, cmd: string) => commands.push([label, cmd])

    if (what === 'auto' || what === 'typecheck') {
      if (inPkg('typecheck')) push('typecheck', 'npm run typecheck')
      else if (inPkg('lint')) push('lint', 'npm run lint')
      else if (has('tsconfig.json')) push('typecheck', 'npx tsc --noEmit')
      else if (what === 'typecheck') return 'No TypeScript config found — nothing to typecheck.'
    }
    if (what === 'auto' || what === 'test') {
      if (inPkg('test')) push('test', 'npm test')
      else if (has('pyproject.toml') || has('pytest.ini')) push('test', 'python -m pytest -q')
      else if (what === 'test') return 'No test runner found — nothing to test.'
    }
    if (what === 'auto' || what === 'build') {
      if (inPkg('build')) push('build', 'npm run build')
      else if (has('pyproject.toml')) push('build', 'python -m build --wheel')
      else if (what === 'build') return 'No build script found — nothing to build.'
    }
    if (commands.length === 0) {
      return 'This project has no recognisable checks (no package.json scripts, tsconfig, or Python project). Say what you verified by hand instead — do not claim success.'
    }

    const out: string[] = []
    for (const [label, cmd] of commands) {
      const started = Date.now()
      try {
        const { stdout, stderr } = await run(cmd, {
          cwd: ws,
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        })
        const body = [stdout, stderr].filter(Boolean).join('\n').trim()
        out.push(`${label}: PASS (${((Date.now() - started) / 1000).toFixed(1)}s)\n${clip(body || '(no output)')}`)
      } catch (err) {
        const e = err as Error & { stdout?: string; stderr?: string }
        const body = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
        out.push(
          `${label}: FAIL\n${clip(body || e.message)}\n\nFix this before saying the change works. The failure above is the real state of the code.`,
        )
        break
      }
    }
    return out.join('\n\n---\n\n')
  },
})

/* ---- scale: what this project actually is ------------------------------- */

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.py': 'Python', '.rs': 'Rust',
  '.go': 'Go', '.java': 'Java', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.kt': 'Kotlin',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML', '.json': 'JSON', '.md': 'Markdown',
  '.toml': 'TOML', '.yaml': 'YAML', '.yml': 'YAML', '.sh': 'Shell', '.sql': 'SQL',
}

export const projectOverviewTool = tool({
  description:
    'See the whole project at its real size: languages, line counts, the biggest files, and the tree shape. Call this FIRST on any existing codebase — before you form an opinion about what this project is. Reading files one by one is how an agent mistakes a large system for a small prototype.',
  inputSchema: z.object({
    depth: z.number().int().min(1).max(4).optional().describe('How deep to draw the tree. Default 2.'),
  }),
  execute: async ({ depth = 2 }) => {
    const root = getWorkspace()
    const { files, truncated } = await walk(root)
    const byLang = new Map<string, { files: number; lines: number }>()
    const biggest: { path: string; lines: number }[] = []
    let totalLines = 0
    let unreadable = 0

    for (const file of files) {
      const ext = file.slice(file.lastIndexOf('.'))
      const lang = LANG_BY_EXT[ext]
      if (!lang) continue
      try {
        const s = statSync(file)
        if (s.size > MAX_READ_BYTES) continue
        const text = readFileSync(file, 'utf8')
        if (text.includes('\0')) continue
        const lines = text.split('\n').length
        totalLines += lines
        const row = byLang.get(lang) ?? { files: 0, lines: 0 }
        byLang.set(lang, { files: row.files + 1, lines: row.lines + lines })
        biggest.push({ path: displayPath(file), lines })
      } catch {
        unreadable++
      }
    }
    biggest.sort((a, b) => b.lines - a.lines)

    const langRows = [...byLang.entries()]
      .sort((a, b) => b[1].lines - a[1].lines)
      .map(([lang, r]) => `  ${lang.padEnd(12)} ${String(r.files).padStart(5)} files  ${r.lines.toLocaleString().padStart(9)} lines`)

    /* a depth-limited tree — shape over noise */
    const treeLines: string[] = []
    const drawTree = (dir: string, prefix: string, level: number) => {
      if (level > depth || treeLines.length > 300) return
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      const dirs = entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))
      const top = entries
        .filter((e) => e.isFile())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 12)
      for (const d of dirs) treeLines.push(`${prefix}${d.name}/`)
      for (const f of top) treeLines.push(`${prefix}${f.name}`)
      for (const d of dirs) drawTree(join(dir, d.name), `${prefix}  `, level + 1)
    }
    drawTree(root, '', 1)

    const parts = [
      `PROJECT SIZE: ${files.length.toLocaleString()} text files, ${totalLines.toLocaleString()} lines of code${truncated ? ' (tree is larger than the walk limit)' : ''}.`,
      '',
      'BY LANGUAGE:',
      ...langRows,
      '',
      'BIGGEST FILES (where the complexity lives):',
      ...biggest.slice(0, 10).map((f) => `  ${f.lines.toLocaleString().padStart(7)} lines  ${f.path}`),
      '',
      'TREE:',
      ...treeLines,
    ]
    if (unreadable) parts.push('', `(${unreadable} files could not be read)`)
    return clip(parts.join('\n'))
  },
})

/* ---- security: find the real problems ----------------------------------- */

const SECRET_PATTERNS: [string, RegExp][] = [
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['private key block', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['generic api key', /(api[_-]?key|apikey|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i],
  ['slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['github token', /gh[pousr]_[A-Za-z0-9]{36,}/],
]

export const securityScanTool = tool({
  description:
    'Scan this project for security problems: hard-coded secrets and, when semgrep is installed, real SAST findings. Requires human approval because it executes commands.',
  inputSchema: z.object({
    path: z.string().optional().describe('Directory to scan, relative to the workspace. Default the whole workspace.'),
  }),
  execute: async ({ path }) => {
    if (!getCapabilities().securityScan) return 'The security scan is switched off in Settings.'
    const root = resolveInside(path ?? '.')
    const findings: string[] = []

    /* 1. secrets — always, no dependency */
    const { files } = await walk(root)
    for (const file of files) {
      try {
        const s = statSync(file)
        if (s.size > MAX_READ_BYTES) continue
        const text = readFileSync(file, 'utf8')
        if (text.includes('\0')) continue
        const lines = text.split('\n')
        for (const [label, re] of SECRET_PATTERNS) {
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              findings.push(`  [secret] ${label} — ${displayPath(file)}:${i + 1}`)
              break
            }
          }
        }
      } catch {}
    }

    /* 2. semgrep, when it is on the machine */
    let semgrepNote = ''
    try {
      await run('semgrep --version', { timeout: 8_000, windowsHide: true })
      const { stdout } = await run('semgrep scan --config auto --quiet --json --no-git-ignore', {
        cwd: root,
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      })
      const report = JSON.parse(stdout) as {
        results?: { check_id?: string; path?: string; start?: { line?: number }; extra?: { severity?: string; message?: string } }[]
        errors?: unknown[]
      }
      const rows = (report.results ?? []).slice(0, 40)
      for (const r of rows) {
        const sev = (r.extra?.severity ?? 'INFO').toUpperCase()
        const msg = (r.extra?.message ?? r.check_id ?? '').split('\n')[0].slice(0, 140)
        findings.push(`  [semgrep ${sev}] ${r.path ?? '?'}:${r.start?.line ?? '?'} — ${msg}`)
      }
      semgrepNote = `semgrep: ${report.results?.length ?? 0} finding(s)`
    } catch {
      semgrepNote = 'semgrep: not installed — run "pipx install semgrep" for full SAST'
    }

    const head = findings.length
      ? `${findings.length} finding(s) — every one of these is real and in this repository right now:`
      : 'No findings: no obvious secrets, and nothing semgrep flagged.'
    return [head, ...findings.slice(0, 40), '', semgrepNote].join('\n')
  },
})

/* ---------------------------------------------------------------------------
   Memory.

   These touch the agent's own store, never the workspace, so they do not need
   approval. They exist so the user never has to repeat a preference, a decision
   or a gotcha they already explained once.
   --------------------------------------------------------------------------- */

export const rememberTool = tool({
  description:
    'Save a durable fact that survives this session — a preference, a decision, a gotcha, a project convention. Use it when the user tells you something you should not have to be told again. One clear sentence, in their terms.',
  inputSchema: z.object({
    text: z.string().describe('The fact, as one clear sentence.'),
    scope: z
      .enum(['project', 'global'])
      .describe('project = this workspace only; global = every project.')
      .default('project'),
  }),
  execute: async ({ text, scope }) => {
    const entry = remember(text, scope)
    return `Remembered (${scope}): ${entry.text}`
  },
})

export const recallTool = tool({
  description:
    'Search the durable memory you saved in earlier sessions. Use it before asking the user something they may already have told you.',
  inputSchema: z.object({
    query: z.string().describe('Words to look for; an empty query returns the newest facts.'),
  }),
  execute: async ({ query }) => {
    const hits = recall(query)
    if (hits.length === 0) return `Nothing in memory matches "${query}".`
    return hits
      .map((h) => {
        const where = h.workspace === null ? 'global' : 'project'
        const when = new Date(h.at).toISOString().slice(0, 10)
        return `- ${h.text}  [${where}, ${when}, id ${h.id}]`
      })
      .join('\n')
  },
})

export const forgetTool = tool({
  description:
    'Delete one entry from durable memory by its id. Use it when a remembered fact is wrong or no longer applies.',
  inputSchema: z.object({
    id: z.string().describe('The id shown next to the entry by recall.'),
  }),
  execute: async ({ id }) => (forget(id) ? `Forgot ${id}.` : `No memory entry with id ${id}.`),
})

/** search every conversation ever held, in this project first and then the
    others — memory is what was kept; this is what was SAID */
export const pastSessionsTool = tool({
  description:
    'Search the conversations of every past session — this project first, then other projects, each labelled with its folder. Use it when the user refers to something discussed before ("we tried that last week", "what did the build print"), or before re-doing work that may already be done. The result names the thread; open it to read more.',
  inputSchema: z.object({
    query: z.string().describe('Words to look for across titles and messages.'),
  }),
  execute: async ({ query }) => {
    const hits = searchHistory(query)
    if (hits.length === 0) return `No past conversation matches "${query}".`
    return hits
      .map((h) => {
        const where = h.currentProject ? 'this project' : h.project ? `project ${h.project}` : 'unassigned project'
        const when = new Date(h.at).toISOString().slice(0, 10)
        return `- [${when}] (${where}) "${h.title}" — ${h.snippet}  [session ${h.sessionId}]`
      })
      .join('\n')
  },
})

/** set a timer — "do this in three minutes" is a real request */
export const scheduleTool = tool({
  description:
    'Set a timer that starts a NEW thread with this prompt when it comes due. Use it when the user says "in N minutes", "in an hour", "tonight", or asks you to come back to something. The timer survives closing the app: it fires the moment Loong is open again. Say the time you set, in the words the user used.',
  inputSchema: z.object({
    after: z.string().describe('How long from now: 3m, 90s, 2h, 1h30m.'),
    prompt: z.string().describe('What to do when it fires, written as a message to yourself — the whole task, not a reference to this conversation.'),
    title: z.string().optional().describe('A short name for the thread it will create.'),
  }),
  execute: async ({ after, prompt, title }) => {
    const ms = parseDelay(after)
    if (!ms) return `${after} is not a delay. Say 3m, 90s, 2h or 1h30m.`
    const timer = addTimer({ afterMs: ms, prompt, title })
    if ('error' in timer) return timer.error
    const at = new Date(timer.at).toLocaleString('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    })
    return `Timer set for ${at} (${after} from now). It will start a thread called "${timer.title}" with that prompt.`
  },
})

/** the agent writing a skill for itself — the part that compounds */
export const learnSkillTool = tool({
  description:
    'Save what you worked out as a SKILL for this project: the steps, the commands, the gotchas — the thing you would otherwise have to rediscover next session. Write the body as instructions to a future you (imperative, concrete, with the real commands). Use it after solving something non-obvious, or when the user says "remember how we did this".',
  inputSchema: z.object({
    name: z.string().describe('A short name: "release-checklist", "fix-windows-build".'),
    description: z.string().describe('One line: what this skill is for, and the words that should trigger it.'),
    body: z.string().describe('The playbook itself — steps, commands, what to watch for.'),
    triggers: z.string().optional().describe('Comma-separated trigger words, if the description is not enough.'),
  }),
  execute: async ({ name, description, body, triggers }) => {
    const result = learnSkill({ name, description, body, triggers })
    return result.ok
      ? `Saved the skill "${name}" — it loads automatically next time the message matches it.`
      : `Could not save the skill: ${result.error}`
  },
})

/** the exact time — the prompt carries it, this is the second opinion */
export const nowTool = tool({
  description:
    'The current date and time, with the timezone. Use it before computing any deadline or delay; never guess.',
  inputSchema: z.object({}),
  execute: async () => {
    const at = new Date()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const offset = -at.getTimezoneOffset() / 60
    return `${at.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} (${tz}, UTC${offset >= 0 ? '+' : ''}${offset})`
  },
})

/** the library, on demand — depth without carrying it in every prompt */
export const readLibraryTool = tool({
  description:
    'Open a topic from the library: real, specific guidance on git, sql, docker, http, testing, security, react, shell. Call it when the task needs the details (a command, a status code, a gotcha) and guessing would be worse than reading. The ids are listed in your prompt under LIBRARY.',
  inputSchema: z.object({
    topic: z.string().describe('A topic id from the LIBRARY list: git, sql, docker, http, testing, security, react, shell.'),
  }),
  execute: async ({ topic }) => {
    const found = readTopic(topic)
    if (!found) return `No library topic matches "${topic}". Try one of: ${listTopics().map((t) => t.id).join(', ')}.`
    return `# ${found.title}\n\n${found.body}`
  },
})

/** find the right topic when the id is not obvious */
export const librarySearchTool = tool({
  description: 'Search the library by words — returns the topics that match and the line that matched.',
  inputSchema: z.object({
    query: z.string().describe('What you are trying to do: "undo a pushed commit", "docker image too big".'),
  }),
  execute: async ({ query }) => {
    const hits = searchTopics(query)
    if (hits.length === 0) return `Nothing in the library matches "${query}".`
    return hits.map((h) => `- ${h.topic.id} (${h.topic.title}): ${h.snippet}`).join('\n')
  },
})

export const TOOLS = {
  list_dir: listDir,
  read_file: readFileTool,
  read_many: readManyTool,
  search_many: searchManyTool,
  edit_many: editManyTool,
  read_image: readImageTool,
  read_document: readDocumentTool,
  library_docs: libraryDocsTool,
  think_step: thinkingTool,
  grep: grepTool,
  /* the repository: status and diff are reads, a commit changes history */
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_log: gitLogTool,
  git_commit: gitCommitTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  multi_edit: multiEditTool,
  mkdir: mkdirTool,
  delete_file: deleteFileTool,
  move_file: moveFileTool,
  shell: shellTool,
  fetch_url: fetchTool,
  web_search: webSearchTool,
  run_verification: verifyTool,
  project_overview: projectOverviewTool,
  security_scan: securityScanTool,
  browser: browserTool,
  remember: rememberTool,
  recall: recallTool,
  past_sessions: pastSessionsTool,
  schedule: scheduleTool,
  learn_skill: learnSkillTool,
  now: nowTool,
  read_library: readLibraryTool,
  library_search: librarySearchTool,
  forget: forgetTool,
}

export type ToolName = keyof typeof TOOLS

/** which tools stop the run and ask a human first */
export const APPROVAL_REQUIRED: ToolName[] = [
  'write_file',
  'edit_file',
  'multi_edit',
  'mkdir',
  'delete_file',
  'move_file',
  'shell',
  /* a commit rewrites history — the one thing a rewind cannot put back */
  'git_commit',
  /* both of these execute the project's own commands */
  'run_verification',
  'security_scan',
]

export { relative }
