import { tool } from 'ai'
import { z } from 'zod'
import { clip } from './config.ts'

/* ---------------------------------------------------------------------------
   Subagents: the task tool.

   One agent in one session could not look two places at once, and it filled
   its own context window doing it. The fix is the pattern Claude Code made
   standard: the main agent delegates a bounded job to a child run with a
   CLEAN context, a restricted toolset, and a cheap model — and gets back one
   summary, not the transcript.

   The child is deliberately stupid in two ways that make it useful:
   it cannot write (read-only tools), and it cannot see the conversation it
   came from. That is what keeps the main context small and the child fast.
   --------------------------------------------------------------------------- */

export interface SubagentRequest {
  /** one line: what the child is being asked to do */
  task: string
  /** what the child is allowed to do — read-only by design.
   *  `fork` is the one that can see this conversation. */
  scope: 'explore' | 'research' | 'fork'
  /** files or directories worth starting from, if the parent knows them */
  hints?: string[]
}

/** tools a child may use — everything here is a read */
export const SUBAGENT_TOOLS = [
  'list_dir',
  'read_file',
  'grep',
  'fetch_url',
  'web_search',
  'project_overview',
  /* the repository is read freely; a child never commits */
  'git_status',
  'git_diff',
  'git_log',
  'recall',
] as const

export function createTaskTool(run: (req: SubagentRequest) => Promise<string>) {  return tool({
    description:
      'Delegate a bounded research job to a child agent with its own context, and get back one summary. Use it when the job is "read a lot and tell me what you found" — exploring unfamiliar code, comparing libraries, checking how something is used across many files. The child can read but never write. scope "fork" lets the child see this whole conversation and costs more; use it when the job depends on what was already discussed instead of starting cold. Do NOT use it to make changes; do those yourself.',
    inputSchema: z.object({
      task: z
        .string()
        .describe('The whole job, in one or two sentences. Specific: which part of the codebase, what question to answer.'),
      scope: z
        .enum(['explore', 'research', 'fork'])
        .describe('"explore" — read this codebase. "research" — search the web. "fork" — inherit this conversation and answer from it.'),
      hints: z
        .array(z.string())
        .max(8)
        .optional()
        .describe('Files or directories the child should start from, if you know them.'),
    }),
    execute: async ({ task, scope, hints }) => {
      const started = Date.now()
      try {
        const summary = await run({ task, scope, hints })
        return `[subagent · ${scope} · ${((Date.now() - started) / 1000).toFixed(0)}s]\n${summary}`
      } catch (err) {
        const message = (err as Error).message
        /* a free plan that allows one tool call per turn cannot run a child
           agent — say that, instead of "failed" and a guess at the cause */
        if (/tool.?call|one tool|rate.?limit|429|free (plan|tier)|quota|insufficient/i.test(message)) {
          return `The subagent could not run: ${message}. This provider's plan may allow only one tool call per turn, and a subagent needs several. Do the reading yourself with the normal tools, or switch to a model with multi-step tool calls.`
        }
        return `The subagent failed: ${message}. Do the work yourself with the normal tools.`
      }
    },
  })
}

/** the fan-out ceiling: one session may launch this many children in one call */
export const MAX_TASKS_PER_CALL = 30
/** the machine ceiling: children across every session together. Two full
 *  thirty-job fan-outs fit, so one session's batch cannot starve another's. */
export const MAX_CHILDREN = 64

let childrenActive = 0
const childWaiters: (() => void)[] = []

function acquireChild(): Promise<void> {
  if (childrenActive < MAX_CHILDREN) {
    childrenActive += 1
    return Promise.resolve()
  }
  /* the slot is handed straight from the finishing child to this waiter, so
     `active` never dips and a burst cannot slip in between */
  return new Promise((resolve) => childWaiters.push(resolve))
}

function releaseChild(): void {
  const next = childWaiters.shift()
  if (next) {
    next()
    return
  }
  childrenActive = Math.max(0, childrenActive - 1)
}

export function childLoad(): { active: number; waiting: number; cap: number } {
  return { active: childrenActive, waiting: childWaiters.length, cap: MAX_CHILDREN }
}

export function resetChildLoadForTests(): void {
  childrenActive = 0
  childWaiters.splice(0)
}

export interface ManyTask {
  task: string
  scope?: 'explore' | 'research' | 'fork'
  hints?: string[]
}

/**
 * Thirty jobs, one call.
 *
 * Calling `task` thirty times means thirty full model turns of latency, and the
 * parent's context pays for each result separately. This tool starts them
 * together behind a process-wide semaphore and returns ONE compact report —
 * enough for the parent to decide what to read itself, not the whole transcript.
 */
export function createTaskManyTool(
  run: (req: SubagentRequest) => Promise<string>,
  onProgress?: (index: number, phase: 'start' | 'end', req: SubagentRequest, detail?: string) => void,
) {
  return tool({
    description: `Run up to ${MAX_TASKS_PER_CALL} independent READ-ONLY research jobs in parallel and get one combined report. Use it when the reading splits into separate questions — one directory each, one library each, one question each — instead of calling task repeatedly. Concurrent children across the whole app are capped at ${MAX_CHILDREN}, and extra jobs wait their turn rather than failing. Do NOT use it for work that changes files: children cannot write.`,
    inputSchema: z.object({
      tasks: z
        .array(
          z.object({
            task: z.string().describe('One self-contained job, in one or two sentences.'),
            scope: z
              .enum(['explore', 'research', 'fork'])
              .optional()
              .describe('Defaults to "explore". "research" searches the web; "fork" sees this conversation.'),
            hints: z
              .array(z.string())
              .max(8)
              .optional()
              .describe('Files or directories this child should start from.'),
          }),
        )
        .min(1)
        .max(MAX_TASKS_PER_CALL)
        .describe(`The jobs. At most ${MAX_TASKS_PER_CALL}.`),
    }),
    execute: async ({ tasks }) => {
      const started = Date.now()
      const results = await Promise.allSettled(
        tasks.map(async (t, i) => {
          const req: SubagentRequest = {
            task: t.task,
            scope: t.scope ?? 'explore',
            hints: t.hints,
          }
          onProgress?.(i, 'start', req)
          await acquireChild()
          try {
            const summary = await run(req)
            onProgress?.(i, 'end', req, 'ok')
            return summary
          } catch (err) {
            onProgress?.(i, 'end', req, 'failed')
            throw err
          } finally {
            releaseChild()
          }
        }),
      )
      /* the parent's context is the scarce resource: a 30-job report is capped
         per item so the batch never costs more than the work it replaces */
      const per = tasks.length > 10 ? 420 : 900
      const lines = results.map((r, i) => {
        const label = `[${i + 1}] ${tasks[i].scope ?? 'explore'}`
        if (r.status === 'fulfilled') {
          return `${label} — ok\n${clip(String(r.value ?? '').trim(), per)}`
        }
        const why = r.reason instanceof Error ? r.reason.message : String(r.reason)
        return `${label} — failed\n${clip(why, 300)}`
      })
      const ok = results.filter((r) => r.status === 'fulfilled').length
      return `[${ok}/${tasks.length} subagents · ${childLoad().active} running · ${((Date.now() - started) / 1000).toFixed(0)}s]\n\n${lines.join('\n\n')}`
    },
  })
}

/** the child's whole world, in its system prompt */
export function subagentSystemPrompt(scope: 'explore' | 'research' | 'fork', task: string): string {
  if (scope === 'fork') {
    return `You are a fork of the Loong conversation above, working for the main agent.

Your job: ${task}

The conversation so far is yours to read. Use it instead of guessing what was meant, and
check the workspace when the answer depends on what the code actually says.

Rules, and they are strict:
- You can only READ. Never write, edit, delete, move, or run anything that changes state.
- Do not restate the conversation. Add what the main agent does not already know.
- End with a report: the answer, the exact file paths and line numbers that matter, and the
  one thing most likely to go wrong. Under 400 words. Quote code only when the exact text matters.
- If the conversation contradicts the workspace, trust the workspace and say so plainly.`
  }
  const where =
    scope === 'explore'
      ? 'Read this codebase. Start with project_overview, then read the files that matter to the task.'
      : 'Search the web and read the pages that answer the task. web_search already reads the top result for you.'
  return `You are a research subagent working for a larger coding agent called Loong.

Your job: ${task}

${where}

Rules, and they are strict:
- You can only READ. Never write, edit, delete, move, or run anything that changes state.
- You have no memory of any conversation. Everything you need is in the task above.
- End with a report, not a transcript: what you found, the exact file paths and line numbers that matter, and anything the main agent should watch out for. Under 400 words. Quote code only when the exact text matters.
- If you cannot find something, say so plainly. A missing answer with the places you looked is worth more than a guess.`
}
