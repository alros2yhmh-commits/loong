/* ---------------------------------------------------------------------------
   Batch tools — one call, many files.

   The cost of an agent is not the model's words, it is the round trips: every
   `read_file` is a full request with the whole conversation attached, so
   reading twenty files cost twenty requests and twenty copies of the history.
   A token bill that looks like the model's fault is almost always the shape of
   the loop.

   So the loop gets wider instead of longer:

     read_many    twenty files, one request, one budget
     outline      a file's structure without its bodies
     search_many  several patterns in one pass
     edit_many    several edits, one approval, one write

   None of them is a new capability. All of them are the same work with fewer
   round trips — which is the only kind of speed-up that compounds.
   --------------------------------------------------------------------------- */

import { readFile, stat } from 'node:fs/promises'
import { tool } from 'ai'
import { z } from 'zod'
import { displayPath, resolveInside } from './config.ts'
import { applyEdits } from './edits.ts'
import { recordWrite } from './journal.ts'

/** how much text one call may return, across all files */
const DEFAULT_BUDGET = 60_000
/** a single file never gets more than this, budget or not */
const PER_FILE_CAP = 24_000
/** more than this is not a batch, it is a directory dump */
const MAX_FILES = 40

function clip(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n… [${text.length - cap} more characters not shown]`
}

/** the shape of a file, without the body — a 900-line module in 20 lines */
export function outlineOf(source: string, path: string): string {
  const lines = source.split('\n')
  const keep: string[] = []
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const patterns: RegExp[] =
    ext === 'py'
      ? [/^\s*(class|def|async def)\s+\w+/, /^\s*@\w+/]
      : ext === 'go'
        ? [/^func\s/, /^type\s/, /^package\s/]
        : ext === 'rs'
          ? [/^\s*(pub\s+)?(fn|struct|enum|impl|trait|mod)\s/]
          : ext === 'css'
            ? [/^[.#@:a-z][^{]*\{$/i]
            : [
                /^\s*(export\s+)?(async\s+)?function\s+\w+/,
                /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/,
                /^\s*(export\s+)?(default\s+)?(class|interface|type|enum)\s+\w+/,
                /^\s*export\s+\{/,
                /^import\s/,
              ]
  lines.forEach((line, i) => {
    if (patterns.some((re) => re.test(line))) {
      keep.push(`${String(i + 1).padStart(5, ' ')}  ${line.trimEnd()}`)
    }
  })
  if (keep.length === 0) return `${path}: no outline (not a source file, or nothing to outline)`
  return `${path}  (${lines.length} lines, ${keep.length} declarations)\n${keep.join('\n')}`
}

export const readManyTool = tool({
  description:
    'Read SEVERAL files in one call — use this instead of calling read_file repeatedly. Returns each file with line numbers, inside one shared budget. Use mode:"outline" first on big or unfamiliar files: it returns only the declarations (functions, classes, exports) with line numbers, which is usually enough to decide what to read in full.',
  inputSchema: z.object({
    paths: z.array(z.string()).min(1).max(MAX_FILES).describe('Files, relative to the workspace root.'),
    mode: z.enum(['full', 'outline']).optional().describe('full (default) or outline — declarations only.'),
    maxCharsPerFile: z.number().int().min(500).max(PER_FILE_CAP).optional(),
    budget: z.number().int().min(2000).max(200_000).optional().describe('Total characters for the whole call.'),
  }),
  execute: async ({ paths, mode = 'full', maxCharsPerFile, budget }) => {
    const total = budget ?? DEFAULT_BUDGET
    const perFile = Math.min(maxCharsPerFile ?? PER_FILE_CAP, total)
    const seen = new Set<string>()
    const out: string[] = []
    let used = 0

    for (const path of paths.slice(0, MAX_FILES)) {
      if (seen.has(path)) continue
      seen.add(path)
      if (used >= total) {
        out.push(`${path}: skipped — the call's budget was used by earlier files`)
        continue
      }
      let abs: string
      try {
        abs = resolveInside(path)
      } catch (e) {
        out.push(`${path}: refused — ${(e as Error).message}`)
        continue
      }
      try {
        const s = await stat(abs)
        if (s.size > 4_000_000) {
          out.push(`${path}: skipped — ${(s.size / 1e6).toFixed(1)} MB, too large to read whole`)
          continue
        }
        const raw = await readFile(abs, 'utf8')
        const remaining = Math.min(perFile, total - used)
        if (mode === 'outline') {
          const body = clip(outlineOf(raw, displayPath(abs)), remaining)
          used += body.length
          out.push(body)
          continue
        }
        const lines = raw.split('\n')
        const width = String(lines.length).length
        const numbered = lines
          .map((l, i) => `${String(i + 1).padStart(width, ' ')}  ${l}`)
          .join('\n')
        const body = clip(`${displayPath(abs)}  (${lines.length} lines)\n${numbered}`, remaining)
        used += body.length
        out.push(body)
      } catch (e) {
        /* a missing file is information, not a failure */
        out.push(`${path}: not readable (${(e as NodeJS.ErrnoException).code ?? "error"})`)
      }
    }

    return `Read ${seen.size} file${seen.size === 1 ? '' : 's'} · ${used} characters\n\n${out.join('\n\n———\n\n')}`
  },
})

export const searchManyTool = tool({
  description:
    'Run SEVERAL searches in one call — use this instead of calling grep repeatedly. Each query is a regex; results are grouped per query with file:line.',
  inputSchema: z.object({
    queries: z
      .array(
        z.object({
          pattern: z.string().describe('A regular expression.'),
          glob: z.string().optional().describe('Optional file filter, e.g. "*.tsx".'),
        }),
      )
      .min(1)
      .max(8),
    maxPerQuery: z.number().int().min(1).max(50).optional(),
  }),
  execute: async ({ queries, maxPerQuery = 15 }) => {
    /* the single grep tool is the implementation; this is the same search run
       several times inside ONE request */
    const { grepTool } = await import('./tools.ts')
    const blocks: string[] = []
    for (const q of queries) {
      try {
        const result = await grepTool.execute!(
          { pattern: q.pattern, glob: q.glob, maxResults: maxPerQuery },
          { toolCallId: 'batch', messages: [] } as never,
        )
        blocks.push(`### /${q.pattern}/\n${String(result)}`)
      } catch (e) {
        blocks.push(`### /${q.pattern}/ → error: ${(e as Error).message}`)
      }
    }
    return blocks.join('\n\n')
  },
})

export const editManyTool = tool({
  description:
    'Apply SEVERAL edits in one call — use this instead of calling edit_file repeatedly. Every edit must match EXACTLY ONCE: all of them are matched and checked for overlap before anything is written, so either every edit to a file lands or none does. The result reports per file.',
  inputSchema: z.object({
    edits: z
      .array(
        z.object({
          path: z.string(),
          find: z.string().describe('The exact text to replace. It must occur once in the file.'),
          replace: z.string(),
        }),
      )
      .min(1)
      .max(20),
  }),
  execute: async ({ edits }) => {
    const { readFile: rf, writeFile: wf } = await import('node:fs/promises')
    const byFile = new Map<string, { find: string; replace: string }[]>()
    for (const e of edits) {
      const list = byFile.get(e.path) ?? []
      list.push({ find: e.find, replace: e.replace })
      byFile.set(e.path, list)
    }
    const report: string[] = []
    for (const [path, list] of byFile) {
      try {
        const abs = resolveInside(path)
        const before = await rf(abs, 'utf8')
        const res = applyEdits(
          before,
          list.map((e) => ({ oldText: e.find, newText: e.replace })),
        )
        if (!res.ok) {
          report.push(`✗ ${path}: ${res.error}`)
          continue
        }
        await wf(abs, res.content, 'utf8')
        recordWrite('write', abs, before)
        report.push(
          `✓ ${path}: ${res.applied} edit${res.applied === 1 ? '' : 's'} applied${
            res.notes.length ? ` (${res.notes.join('; ')})` : ''
          }`,
        )
      } catch (e) {
        report.push(`✗ ${path}: ${(e as Error).message}`)
      }
    }
    return report.join('\n')
  },
})
