import { tool } from 'ai'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { getWorkspace, clip } from './config.ts'

/* ---------------------------------------------------------------------------
   Git.

   Every one of the three leading agents in 2026 — Claude Code, Cursor, Codex —
   treats the repository as a first-class surface: status, diff, log, commit,
   PR. Loong had a journal that could undo a run, and no way to see or make
   history. This closes that.

   Three rules, the same ones the filesystem tools live by:
     1. Every command runs with cwd = the workspace. There is no argument that
        can escape it.
     2. Reads (status, diff, log) never ask for approval. A commit does — it
        changes history, and history is the one thing a rewind cannot put back.
     3. Output is clipped here, like every other tool, because `git log` on a
        big repo is a way to fill a context window on purpose.
   --------------------------------------------------------------------------- */

const GIT_TIMEOUT_MS = 20_000
const MAX_OUT = 24_000

/** run git and return stdout+stderr, never throwing — a failure is an answer */
function git(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: getWorkspace(),
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          /* commit identity: the agent signs as itself, never as the reader */
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join('\n').trim()
        const code = err && 'code' in err ? Number((err as { code?: number }).code ?? 1) : 0
        resolve({ code, out })
      },
    )
  })
}

const fail = (out: string) =>
  /not a git repository|fatal:|is not a git/i.test(out)

export const gitStatusTool = tool({
  description:
    'Show the state of the git repository: branch, upstream, staged and unstaged changes, untracked files. Read-only, no approval.',
  inputSchema: z.object({}),
  execute: async () => {
    const { out } = await git(['status', '--short', '--branch'])
    if (fail(out)) {
      return `No git repository at ${getWorkspace()}. Run "git init" from the shell if this folder should be one.`
    }
    /* --branch always prints its line, even on a clean tree — drop it before
       deciding there is nothing to report */
    const lines = out.split('\n').filter((l) => l && !l.startsWith('## '))
    if (lines.length === 0) {
      const branch = /^## (.+)$/m.exec(out)?.[1] ?? 'the branch'
      return `Clean working tree on ${branch} — nothing staged, nothing modified, nothing untracked.`
    }
    return `git status (${getWorkspace()}):\n${clip(out, MAX_OUT)}`
  },
})

export const gitDiffTool = tool({
  description:
    'Show what changed in the repository as a diff. By default unstaged changes; set staged for what is already added; limit with a path. Read-only, no approval.',
  inputSchema: z.object({
    staged: z.boolean().optional().describe('Show staged changes instead of unstaged.'),
    path: z.string().optional().describe('Limit the diff to one file or directory.'),
    max_lines: z.number().optional().describe('Cap the diff length in lines.'),
  }),
  execute: async ({ staged, path, max_lines }) => {
    const args = ['diff', '--no-color']
    if (staged) args.push('--staged')
    if (path) args.push('--', path)
    const { out } = await git(args)
    if (fail(out)) return `No git repository at ${getWorkspace()}.`
    if (!out) return staged ? 'Nothing staged.' : 'No changes to show.'
    const cap = Math.max(20, Math.min(max_lines ?? 400, 2000))
    const lines = out.split('\n')
    const body = lines.length > cap ? `${lines.slice(0, cap).join('\n')}\n… ${lines.length - cap} more lines` : out
    return clip(body, MAX_OUT)
  },
})

export const gitLogTool = tool({
  description:
    'Show recent commits: hash, date, author, subject. Use it before committing, to match the repository’s own commit-message style. Read-only, no approval.',
  inputSchema: z.object({
    count: z.number().optional().describe('How many commits to show (default 15, max 60).'),
    path: z.string().optional().describe('Only commits that touched this file or directory.'),
  }),
  execute: async ({ count, path }) => {
    const n = Math.max(1, Math.min(count ?? 15, 60))
    const args = [
      'log',
      `--max-count=${n}`,
      '--date=short',
      '--pretty=format:%h %ad %an %s',
      '--no-color',
    ]
    if (path) args.push('--', path)
    const { out } = await git(args)
    if (fail(out)) return `No git repository at ${getWorkspace()}.`
    if (!out) return 'No commits yet.'
    return clip(out, MAX_OUT)
  },
})

export const gitCommitTool = tool({
  description:
    'Commit the current changes. Stages nothing by default: use stage_paths to add specific files first, or stage_all for everything. Requires human approval before it runs.',
  inputSchema: z.object({
    message: z.string().describe('The commit message. Follow the style of the recent git log.'),
    stage_paths: z
      .array(z.string())
      .optional()
      .describe('Paths to stage before committing, relative to the workspace root.'),
    stage_all: z.boolean().optional().describe('Stage every change including untracked files.'),
  }),
  execute: async ({ message, stage_paths, stage_all }) => {
    if (stage_all) {
      const add = await git(['add', '-A'])
      if (add.code !== 0) return `git add failed:\n${clip(add.out, MAX_OUT)}`
    } else if (stage_paths?.length) {
      const add = await git(['add', '--', ...stage_paths])
      if (add.code !== 0) return `git add failed:\n${clip(add.out, MAX_OUT)}`
    }

    const { code, out } = await git(['commit', '-m', message])
    const body = clip(out, MAX_OUT)
    if (code !== 0) {
      /* nothing staged is the common case and reads like a failure to the model */
      if (/nothing to commit|no changes added/i.test(body)) {
        return 'Nothing to commit — the working tree is clean or nothing is staged. Use git_status to see what is there.'
      }
      return `git commit failed:\n${body}`
    }
    const head = await git(['log', '-1', '--pretty=format:%h %s'])
    return `Committed: ${head.out || body}`
  },
})
