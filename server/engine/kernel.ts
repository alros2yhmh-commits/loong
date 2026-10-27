import { asSchema, streamText, type LanguageModel, type ToolSet } from 'ai'
import { EventType, type BaseEvent } from '@ag-ui/core'
import { callProviderOptions, type ProviderConfig } from '../providers.ts'
import { ThinkFilter } from '../think.ts'
import { clip } from '../config.ts'
import { toModelMessages, type HistoryTurn } from './messages.ts'

/* ---------------------------------------------------------------------------
   The kernel.

   One iteration at a time: ask the model, take the tool calls it asked for,
   run them, put the results back into the conversation, ask again. Everything
   that decides what a run may do — approvals, leases, hooks, the cycle, the
   evidence gate — stays on the tool boundary above this file. The kernel only
   owns the loop.

   Three things this loop does that a single long stream cannot:

     · it keeps the transcript between passes, so a run that hits its step
       ceiling resumes instead of restarting;
     · it runs independent tool calls together, because nine reads that do not
       depend on each other should cost one step, not nine;
     · a picture a tool produced is handed back as a file part, so the model
       sees it instead of reading megabytes of base64 it cannot interpret.

   It talks to a provider only through Loong's own resolved model and provider
   options, so every provider the app supports works unchanged.
   --------------------------------------------------------------------------- */

export interface KernelPassOptions {
  runId: string
  threadId: string
  model: LanguageModel
  config: ProviderConfig
  /** rebuilt before every step so the phase block is never stale */
  system: () => string
  tools: ToolSet
  turns: HistoryTurn[]
  /** model calls this pass may make */
  maxSteps: number
  abortSignal?: AbortSignal
  emit: (event: BaseEvent) => void
  onStep?: () => void
  onNotice?: (text: string) => void
  /** the repetition guard, owned by the caller */
  checkLoop?: (text: string) => boolean
  /** Loong's own classifier, so the caller decides what is worth a retry */
  errorRetryable: (message: string) => boolean
}

export interface KernelPassResult {
  ok: boolean
  empty: boolean
  error: string | null
  text: string
  produced: boolean
  steps: number
  repetition: boolean
  /** the step ceiling was reached with work still in hand — a pause, not a fault */
  stepLimit: boolean
  usage: { inputTokens?: number; outputTokens?: number } | null
  /** the run's canonical transcript, so the next pass sees what this one did */
  history: HistoryTurn[]
}

/** enough for a long codegen answer; a provider pre-reserves it against the
    account, so asking for the model's whole window fails on a modest plan */
const MAX_OUTPUT_TOKENS = 8192

/* ---------------------------------------------------------------------------
   Which calls may run together.

   A read has no side effect and no ordering, so nine of them are one wait.
   Anything that writes, asks a human, spawns a subagent or starts a process
   keeps the order the model wrote it in — those are the calls where "the
   second one saw the first one's result" is a promise, not an accident.
   --------------------------------------------------------------------------- */

const SEQUENTIAL = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'edit_many',
  'delete_file',
  'move_file',
  'mkdir',
  'propose_changes',
  'run_code',
  'shell',
  'terminal',
  'desktop',
  'server_start',
  'server_stop',
  'run_project',
  'stop_project',
  'ask_user',
  'update_plan',
  'task',
  'task_many',
  'git_commit',
  'run_verification',
  'security_scan',
])

function mayRunTogether(name: string): boolean {
  return !SEQUENTIAL.has(name)
}

/* ---------------------------------------------------------------------------
   History in the model's shape.
   --------------------------------------------------------------------------- */

function base(runId: string, threadId: string) {
  return { runId, threadId, timestamp: Date.now() }
}

/** the provider's error text, whatever shape it arrived in.
 *
 *  An OpenRouter 429 does not say "429" anywhere in `message` — it says
 *  "Provider returned error" and puts the status on the error object and the
 *  reason inside `responseBody`. Classification downstream reads the STRING, so
 *  a rate limit that should have been retried looked like a fatal provider
 *  fault, and the reader got four words that explain nothing. Both facts are
 *  lifted into the message here. */
function messageOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const box = err as Error & { statusCode?: unknown; responseBody?: unknown; cause?: unknown }
  const status = typeof box.statusCode === 'number' ? box.statusCode : null
  const head = status && !err.message.includes(String(status))
    ? `${err.message} (HTTP ${status})`
    : err.message
  const detail = providerDetail(box.responseBody) ?? providerDetail((box.cause as { responseBody?: unknown })?.responseBody)
  if (!detail) return head
  const trimmed = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail
  return head.includes(trimmed) ? head : `${head}: ${trimmed}`
}

/** the sentence the provider actually wrote, out of its own JSON envelope */
function providerDetail(body: unknown): string | null {
  if (typeof body !== 'string' || body.trim().length === 0) return null
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; metadata?: { raw?: unknown } }
      message?: unknown
    }
    const raw = parsed.error?.metadata?.raw
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    /* not JSON: an HTML error page or a plain sentence */
    return body.trim()
  }
  return null
}

/** a context overflow is recoverable: shed the oldest turns and ask again */
function isOverflow(message: string): boolean {
  return /context.{0,20}(length|window)|maximum context|too many tokens|prompt is too long|reduce the length/i.test(
    message,
  )
}

/** the runtime's step ceiling is a pause, not a fault: the work is unfinished */
export function isStepLimit(message: string): boolean {
  return /maxIterations|max iterations|step limit/i.test(message)
}

function textOf(output: unknown): string {
  if (typeof output === 'string') return output
  if (output === undefined || output === null) return ''
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

interface ImageOutput {
  shotBase64: string
  shot?: string
}

/** read_image answers with the picture, not a description of it */
function imageOutput(output: unknown): ImageOutput | null {
  if (!output || typeof output !== 'object') return null
  const box = output as { shotBase64?: unknown; shot?: unknown }
  if (typeof box.shotBase64 !== 'string' || box.shotBase64.length === 0) return null
  return { shotBase64: box.shotBase64, shot: typeof box.shot === 'string' ? box.shot : undefined }
}

/** the tool set the model is offered: schemas only.
 *
 *  No execute here on purpose. The kernel calls Loong's wrapped tool itself,
 *  one iteration at a time — if the SDK executed them, the loop would belong to
 *  the SDK and the step accounting, the parallel batch and the transcript would
 *  all be guesses about what it did. */
function offeredTools(tools: ToolSet): ToolSet {
  const out: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(
    tools as Record<string, { description?: string; inputSchema?: unknown }>,
  )) {
    if (!definition.description || !definition.inputSchema) continue
    /* the schema is passed through as it was written — a zod schema stays zod,
       a JSON schema stays JSON — and the execute is left out */
    const { execute: _execute, ...schemaOnly } = definition as Record<string, unknown>
    out[name] = schemaOnly
  }
  return out as ToolSet
}

/* ---------------------------------------------------------------------------
   One pass.
   --------------------------------------------------------------------------- */

export async function runKernelPass(opts: KernelPassOptions): Promise<KernelPassResult> {
  const { runId, threadId, emit } = opts
  const think = new ThinkFilter()
  const textId = `msg-${runId}`
  const reasoningId = `rsn-${runId}`
  let textOpen = false
  let reasoningOpen = false
  let produced = false
  let streamedText = ''
  let steps = 0
  let repetition = false
  let failure: string | null = null
  let stepLimit = false
  const usageAcc = { input: 0, output: 0 }
  let overflowed = false

  /* the run's transcript, in Loong's shape — the caller keeps it across passes */
  const turns: HistoryTurn[] = opts.turns.map((turn) => ({ ...turn }))
  /* the pictures this pass handed the model, by tool call id */
  const images = new Map<string, string>()

  const openText = () => {
    if (textOpen) return
    textOpen = true
    emit({ type: EventType.TEXT_MESSAGE_START, messageId: textId, role: 'assistant', ...base(runId, threadId) } as BaseEvent)
  }
  const closeText = () => {
    if (!textOpen) return
    textOpen = false
    emit({ type: EventType.TEXT_MESSAGE_END, messageId: textId, ...base(runId, threadId) } as BaseEvent)
  }
  const openReasoning = () => {
    if (reasoningOpen) return
    reasoningOpen = true
    emit({ type: EventType.REASONING_START, messageId: reasoningId, ...base(runId, threadId) } as BaseEvent)
    emit({ type: EventType.REASONING_MESSAGE_START, messageId: reasoningId, role: 'assistant', ...base(runId, threadId) } as BaseEvent)
  }
  const closeReasoning = () => {
    if (!reasoningOpen) return
    reasoningOpen = false
    emit({ type: EventType.REASONING_MESSAGE_END, messageId: reasoningId, ...base(runId, threadId) } as BaseEvent)
    emit({ type: EventType.REASONING_END, messageId: reasoningId, ...base(runId, threadId) } as BaseEvent)
  }

  const offered = offeredTools(opts.tools)
  const executable = opts.tools as Record<
    string,
    {
      inputSchema?: unknown
      execute?: (input: unknown, context: { toolCallId: string }) => unknown
    }
  >

  /* run one call through Loong's wrapper — approvals, leases, hooks and the
     cycle all live inside it, so the kernel never re-implements a gate */
  const runCall = async (call: { toolCallId: string; toolName: string; input: unknown }) => {
    const target = executable[call.toolName]
    if (!target || typeof target.execute !== 'function') {
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: `No tool named ${call.toolName} exists in this mode.`,
        ok: false,
      }
    }
    /* The model's arguments are not trusted because they arrived as JSON.
       Validating here is not ceremony: without it a `done_when` sent as a
       string reached the plan tool, threw "done_when.map is not a function"
       inside it, and the model spent four calls learning nothing. */
    let input: unknown = call.input ?? {}
    try {
      const parsed = await asSchema(target.inputSchema as never).validate?.(input)
      if (parsed && !parsed.success) {
        const detail = parsed.error instanceof Error ? parsed.error.message : String(parsed.error)
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: `Invalid arguments for ${call.toolName}: ${detail}. Fix the arguments and call it again — do not repeat the same call.`,
          ok: false,
        }
      }
      if (parsed?.success) input = parsed.value
    } catch {
      /* a schema that cannot validate is not a reason to refuse the call */
    }
    try {
      const raw = await target.execute(input, { toolCallId: call.toolCallId })
      const image = imageOutput(raw)
      if (image) {
        images.set(call.toolCallId, image.shotBase64)
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: `[image ${image.shot ?? 'read'} — shown to you in this run]`,
          ok: true,
          image: image.shotBase64,
        }
      }
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: textOf(raw),
        ok: true,
      }
    } catch (err) {
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: `The tool failed: ${messageOf(err)}`,
        ok: false,
      }
    }
  }

  /** a pass that reported no tokens reports nothing — not a row of zeros */
  const usageOrNull = (): { inputTokens?: number; outputTokens?: number } | null =>
    usageAcc.input || usageAcc.output
      ? { inputTokens: usageAcc.input, outputTokens: usageAcc.output }
      : null

  /* How many model calls a picture stays attached for.
     An image in the transcript is re-sent on EVERY step after it: nineteen
     vision challenges meant nineteen base64 pictures riding along on every
     call — megabytes of context per step, and a bill to match. Two steps is
     enough to reason about a picture; after that the transcript keeps a
     receipt and the model can read the file again if it still needs it. */
  const IMAGE_STEPS = 2
  const imageAge = new Map<string, number>()
  const ageImages = () => {
    for (const turn of turns) {
      if (turn.role !== 'tool' || !turn.toolResults) continue
      for (const result of turn.toolResults) {
        if (!result.image) continue
        const age = (imageAge.get(result.toolCallId) ?? 0) + 1
        imageAge.set(result.toolCallId, age)
        if (age > IMAGE_STEPS) {
          delete result.image
          if (!result.output.includes('no longer attached')) {
            result.output = `${result.output} — the picture is no longer attached; read it again if you need to look at it`
          }
        }
      }
    }
  }

  while (steps < Math.max(1, opts.maxSteps)) {
    if (opts.abortSignal?.aborted) break
    ageImages()
    steps += 1
    opts.onStep?.()
    emit({ type: EventType.STEP_STARTED, stepName: 'step', ...base(runId, threadId) } as BaseEvent)

    let stepText = ''
    const calls: { toolCallId: string; toolName: string; input: unknown }[] = []

    try {
      const result = streamText({
        model: opts.model,
        system: opts.system(),
        messages: toModelMessages(turns),
        ...(Object.keys(offered).length > 0 ? { tools: offered } : {}),
        abortSignal: opts.abortSignal,
        /* the caller's attempt loop owns retries and decides which faults are
           worth one — a second silent policy underneath it is a storm */
        maxRetries: 0,
        /* the SDK's default is to print the whole error object — request body,
           headers and all — to stderr. The error is surfaced through the stream
           and classified by the caller; this is not a second opinion. */
        onError: () => {},
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        providerOptions: callProviderOptions(opts.config) as never,
      })

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          produced = true
          closeReasoning()
          const clean = think.push(part.text)
          if (!clean) continue
          /* whitespace before the message opens is not content — it used to
             leave an empty bubble in the transcript */
          if (!textOpen && !clean.trim()) continue
          openText()
          stepText += clean
          streamedText += clean
          emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textId, delta: clean, ...base(runId, threadId) } as BaseEvent)
          if (opts.checkLoop?.(streamedText)) {
            repetition = true
            break
          }
        } else if (part.type === 'reasoning-delta') {
          produced = true
          openReasoning()
          emit({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningId, delta: part.text, ...base(runId, threadId) } as BaseEvent)
        } else if (part.type === 'tool-call') {
          produced = true
          closeReasoning()
          calls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input })
        } else if (part.type === 'error') {
          throw part.error instanceof Error ? part.error : new Error(messageOf(part.error))
        } else if (part.type === 'finish') {
          try {
            const total = await result.totalUsage
            usageAcc.input += total.inputTokens ?? 0
            usageAcc.output += total.outputTokens ?? 0
          } catch {
            /* usage is reporting, not correctness */
          }
        }
      }
    } catch (err) {
      if (opts.abortSignal?.aborted) {
        closeText()
        closeReasoning()
        return {
          ok: false,
          empty: false,
          error: 'aborted',
          text: streamedText,
          produced,
          steps,
          repetition: false,
          stepLimit: false,
          usage: usageOrNull(),
          history: turns,
        }
      }
      const message = messageOf(err)
      /* one recovery: the conversation outgrew the window, so shed the oldest
         turns and ask again — with the transcript intact, not from zero */
      if (!overflowed && isOverflow(message) && turns.length > 6) {
        overflowed = true
        const head = turns.slice(0, 1)
        const tail = turns.slice(-6)
        turns.splice(0, turns.length, ...head, ...tail)
        opts.onNotice?.('The conversation outgrew the model context — older turns were compacted and the run continued.')
        steps -= 1
        continue
      }
      failure = message
      break
    }

    /* a tag split across the last two deltas lands here */
    const rest = think.flush()
    if (rest) {
      openText()
      stepText += rest
      streamedText += rest
      emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textId, delta: rest, ...base(runId, threadId) } as BaseEvent)
    }
    closeText()
    closeReasoning()
    emit({ type: EventType.STEP_FINISHED, stepName: 'step', ...base(runId, threadId) } as BaseEvent)

    if (repetition) {
      /* the half-sentence that looped is not an answer, but the calls it made
         before looping did happen — keep the transcript honest */
      if (calls.length > 0) {
        turns.push({ role: 'assistant', content: stepText, toolCalls: calls })
      } else if (stepText.trim()) {
        turns.push({ role: 'assistant', content: stepText })
      }
      return {
        ok: false,
        empty: false,
        error: 'repetition',
        text: streamedText,
        produced,
        steps,
        repetition: true,
        stepLimit: false,
        usage: usageOrNull(),
        history: turns,
      }
    }

    /* the model said something and asked for nothing: the turn is over */
    if (calls.length === 0) {
      if (stepText.trim()) turns.push({ role: 'assistant', content: stepText })
      break
    }

    /* the assistant turn goes into the transcript BEFORE the tools run, so a
       result always answers a call the conversation already contains */
    turns.push({ role: 'assistant', content: stepText, toolCalls: calls })
    for (const call of calls) {
      emit({ type: EventType.TOOL_CALL_START, toolCallId: call.toolCallId, toolCallName: call.toolName, ...base(runId, threadId) } as BaseEvent)
      emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: call.toolCallId, delta: JSON.stringify(call.input ?? {}), ...base(runId, threadId) } as BaseEvent)
      emit({ type: EventType.TOOL_CALL_END, toolCallId: call.toolCallId, ...base(runId, threadId) } as BaseEvent)
    }

    /* Independent reads go together; anything with a side effect keeps the
       order the model wrote it in. */
    const results: NonNullable<HistoryTurn['toolResults']> = []
    let cursor = 0
    while (cursor < calls.length) {
      const head = calls[cursor]
      if (!mayRunTogether(head.toolName)) {
        const one = await runCall(head)
        report(one)
        results.push(one)
        cursor += 1
        continue
      }
      /* the longest run of consecutive safe calls is one batch */
      let end = cursor
      while (end < calls.length && mayRunTogether(calls[end].toolName)) end += 1
      const batch = calls.slice(cursor, end)
      const done = await Promise.all(batch.map((call) => runCall(call)))
      for (const one of done) {
        report(one)
        results.push(one)
      }
      cursor = end
    }

    turns.push({ role: 'tool', content: '', toolResults: results })

    if (opts.abortSignal?.aborted) break
    /* the ceiling was reached with the model still asking for tools: the task
       is not finished, and saying so is the caller's decision, not a failure */
    if (steps >= Math.max(1, opts.maxSteps)) {
      stepLimit = true
      break
    }
  }

  function report(result: NonNullable<HistoryTurn['toolResults']>[number]) {
    const image = images.has(result.toolCallId)
    const body = image
      ? result.output
      : clip(result.ok ? result.output : `Tool failed: ${result.output}`)
    emit({
      type: EventType.TOOL_CALL_RESULT,
      messageId: result.toolCallId,
      toolCallId: result.toolCallId,
      content: body,
      role: 'tool',
      /* the status dot is only worth drawing if it can be red */
      isError: !result.ok,
      ...base(runId, threadId),
    } as unknown as BaseEvent)
  }

  closeText()
  closeReasoning()

  return {
    ok: !failure && !repetition,
    empty: !failure && !repetition && !produced && !streamedText.trim(),
    error: failure,
    text: streamedText,
    produced,
    steps,
    repetition,
    stepLimit,
    usage: usageOrNull(),
    history: turns,
  }
}
