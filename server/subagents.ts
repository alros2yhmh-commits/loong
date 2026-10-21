import { tool } from 'ai'
import { z } from 'zod'

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
  /** what the child is allowed to do — read-only by design */
  scope: 'explore' | 'research'
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
] as const

export function createTaskTool(run: (req: SubagentRequest) => Promise<string>) {
  return tool({
    description:
      'Delegate a bounded research job to a child agent with its own clean context, and get back one summary. Use it when the job is "read a lot and tell me what you found" — exploring unfamiliar code, comparing libraries, checking how something is used across many files. The child can read but never write, and it cannot see this conversation. Do NOT use it to make changes; do those yourself.',
    inputSchema: z.object({
      task: z
        .string()
        .describe('The whole job, in one or two sentences. Specific: which part of the codebase, what question to answer.'),
      scope: z
        .enum(['explore', 'research'])
        .describe('"explore" — read this codebase. "research" — search the web and read pages.'),
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

/** the child's whole world, in its system prompt */
export function subagentSystemPrompt(scope: 'explore' | 'research', task: string): string {
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
