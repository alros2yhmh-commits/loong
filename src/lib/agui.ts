import type {
  AgentEvent,
  ApprovalRequest,
  Audit,
  Plan,
  PlanStep,
  QuestionRequest,
  ToolCall,
  ToolName,
  ToolResult,
} from './contract'

/* ---------------------------------------------------------------------------
   AG-UI → the interface's own vocabulary.

   The wire protocol is AG-UI. The interface speaks in blocks. This file is the
   only place that knows both, and it is deliberately a pure state machine: push
   an event in, get zero or more interface events out. No timers, no sockets, no
   React — which is exactly why it can be tested exhaustively without a model.

   AG-UI splits a tool call across three events (START, ARGS deltas, END) and a
   reasoning block across three more. The interface wants one finished object, so
   the accumulation happens here rather than leaking into the view.
   --------------------------------------------------------------------------- */

export interface AguiEvent {
  type: string
  [key: string]: unknown
}

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** the side that failed, in words — so the thread never says just "failed" */
function causeLabel(cause: string, model: string): string {
  const on = model ? ` (${model})` : ''
  switch (cause) {
    case 'provider':
      return `Failed on the provider's side${on} — it refused or was unreachable. Not the app.`
    case 'credit':
      return `Failed on billing${on} — this account cannot pay for that model. Pick a model ending in ":free".`
    case 'model-empty':
      return `Failed on the model's side${on} — it answered nothing on every attempt. Try another model.`
    case 'capability':
      return `Failed on the model's side${on} — it cannot run on Loong (harness-gated or batch-only). Pick another.`
    case 'repetition':
      return `Stopped on purpose${on} — the model looped on itself, so the run was ended before it drained tokens.`
    case 'tool':
      return `Stopped on a tool — it refused the call and the run could not continue.`
    default:
      return `Failed inside Loong — this is our bug, not the provider's. Report it with the run open.`
  }
}

/** tool names the interface has icons for; anything else falls back to a generic card */
const KNOWN_TOOLS: ToolName[] = [
  'read_file',
  'grep',
  'shell',
  'write_file',
  'web_search',
]

function asToolName(name: string): ToolName {
  /* the contract has five icon families; every tool maps into one of them and
     keeps its real name in `wire` for the timeline and the card title */
  if (name === 'list_dir' || name === 'project_overview') return 'grep'
  if (name === 'fetch_url' || name === 'browser' || name === 'library_docs') return 'web_search'
  if (name === 'run_verification' || name === 'security_scan' || name === 'terminal' || name === 'run_project')
    return 'shell'
  if (name === 'remember' || name === 'forget') return 'write_file'
  if (name === 'recall') return 'grep'
  return (KNOWN_TOOLS as string[]).includes(name)
    ? (name as ToolName)
    : 'read_file'
}

/** the short line shown on the collapsed card */
export function toolTitle(name: string, input: Record<string, unknown>): string {
  const first = (k: string) => (typeof input[k] === 'string' ? String(input[k]) : '')
  switch (name) {
    case 'shell':
      return first('command') || 'shell'
    case 'read_file':
    case 'write_file':
      return first('path') || name
    case 'list_dir':
      return first('path') || '.'
    case 'grep':
      return first('pattern') || 'search'
    case 'fetch_url':
      return first('url') || 'fetch'
    case 'web_search':
      return first('query') || 'search'
    case 'library_docs':
      return `${first('library')} docs` || 'library docs'
    case 'think_step':
      return (first('thought').slice(0, 60) || 'thinking') + '…'
    case 'read_document':
    case 'read_image':
      return first('path') || name
    case 'project_overview':
      return 'the whole project'
    case 'run_verification':
      return `${first('what') || 'auto'} checks`
    case 'security_scan':
      return first('path') || 'security scan'
    case 'browser':
      return `${first('action') || 'browser'} ${first('argument')}`.trim()
    case 'task':
      return first('task') || 'subagent'
    case 'remember':
      return first('text').slice(0, 70) || 'remember'
    case 'recall':
      return first('query') || 'recall'
    case 'forget':
      return first('id') || 'forget'
    case 'terminal':
      return first('command') || first('action') || 'terminal'
    case 'run_project':
      return 'run the project'
    case 'compare_screens':
      return 'compare screenshots'
    default:
      return name
  }
}

interface OpenTool {
  name: string
  args: string
}

export class AguiBridge {
  private openTools = new Map<string, OpenTool>()
  private reasoning = new Map<string, string>()
  private approvals = new Map<string, ApprovalRequest>()

  /** push one wire event, get back zero or more interface events, in order */
  push(event: AguiEvent): AgentEvent[] {
    const at = num(event.timestamp, Date.now())

    switch (event.type) {
      case 'RUN_STARTED':
        return [
          {
            kind: 'session',
            at,
            id: str(event.threadId, 'thread'),
            title: '',
          },
        ]

      case 'TEXT_MESSAGE_CONTENT': {
        const delta = str(event.delta)
        if (!delta) return []
        return [
          { kind: 'token', at, id: str(event.messageId, 'msg'), text: delta },
        ]
      }

      case 'TEXT_MESSAGE_END':
        return [{ kind: 'message', at, id: str(event.messageId, 'msg'), text: '' }]

      /* reasoning arrives as start / deltas / end. The interface shows one
         thought per block, so the deltas are accumulated here. */
      case 'REASONING_MESSAGE_START': {
        const id = str(event.messageId, 'reasoning')
        this.reasoning.set(id, '')
        return []
      }

      case 'REASONING_MESSAGE_CONTENT': {
        const id = str(event.messageId, 'reasoning')
        const next = (this.reasoning.get(id) ?? '') + str(event.delta)
        this.reasoning.set(id, next)
        return []
      }

      case 'REASONING_MESSAGE_END': {
        const id = str(event.messageId, 'reasoning')
        const text = this.reasoning.get(id) ?? ''
        this.reasoning.delete(id)
        if (!text.trim()) return []
        return [{ kind: 'thinking', at, id, text: text.trim() }]
      }

      case 'TOOL_CALL_START': {
        const id = str(event.toolCallId)
        if (!id) return []
        const name = str(event.toolCallName, 'tool')
        this.openTools.set(id, { name, args: '' })
        /* the card appears now, while the call is still running — a shell
           command that takes a minute should not be invisible for that minute */
        const call: ToolCall = {
          id,
          tool: asToolName(name),
          title: toolTitle(name, {}),
          input: {},
          wire: name,
          live: true,
        }
        return [{ kind: 'tool_call', at, call, live: true }]
      }

      case 'TOOL_CALL_ARGS': {
        const id = str(event.toolCallId)
        const open = this.openTools.get(id)
        if (!open) return []
        const delta = str(event.delta)
        open.args += delta
        if (!delta) return []
        /* forwarded so the open card can show the arguments building up */
        return [{ kind: 'tool_args', at, id, delta }]
      }

      case 'TOOL_CALL_END': {
        const id = str(event.toolCallId)
        const open = this.openTools.get(id)
        if (!open) return []
        this.openTools.delete(id)

        let input: Record<string, unknown> = {}
        try {
          const parsed: unknown = JSON.parse(open.args || '{}')
          if (parsed && typeof parsed === 'object') {
            input = parsed as Record<string, unknown>
          }
        } catch {
          /* a model that emits malformed JSON still gets a card, so the failure
             is visible rather than silent */
          input = { _raw: open.args }
        }

        const call: ToolCall = {
          id,
          tool: asToolName(open.name),
          title: toolTitle(open.name, input),
          input,
          wire: open.name,
          /* still live: the tool has not produced its result yet */
          live: true,
        }
        return [{ kind: 'tool_call', at, call, live: true }]
      }

      case 'TOOL_CALL_RESULT': {
        const id = str(event.toolCallId)
        if (!id) return []
        const content = str(event.content)
        const result: ToolResult = {
          id,
          ok: !/^(Tool failed|Refused|The command was killed)/.test(content),
          output: content,
          ms: 0,
        }
        return [{ kind: 'tool_result', at, result }]
      }

      case 'CUSTOM': {
        const name = str(event.name)
        if (name === 'loong.approval_requested') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const rawFiles = Array.isArray(v.files) ? v.files : []
          const files = rawFiles.map((f) => {
            const o = (f ?? {}) as Record<string, unknown>
            return {
              path: str(o.path),
              before: typeof o.before === 'string' ? o.before : null,
              after: typeof o.after === 'string' ? o.after : '',
            }
          })
          const request: ApprovalRequest = {
            id: str(v.id),
            tool: asToolName(str(v.tool)),
            wire: typeof v.wire === 'string' ? v.wire : undefined,
            title: str(v.title),
            detail: str(v.detail),
            files: files.length ? files : undefined,
          }
          this.approvals.set(request.id, request)
          return [{ kind: 'approval', at, request }]
        }
        if (name === 'loong.approval_resolved') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const id = str(v.id)
          /* the server tells us the outcome; the interface only needs to stop
             showing the gate, which happens when the run moves on */
          this.approvals.delete(id)
          return []
        }
        if (name === 'loong.tool_duration') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const id = str(v.id)
          if (!id) return []
          return [{ kind: 'tool_duration', at, id, ms: num(v.ms, 0) }]
        }
        if (name === 'loong.plan') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const raw = Array.isArray(v.steps) ? v.steps : []
          const valid = new Set(['pending', 'in_progress', 'done', 'blocked'])
          const steps: PlanStep[] = raw.map((s) => {
            const o = (s ?? {}) as Record<string, unknown>
            const status = str(o.status)
            return {
              description: str(o.description),
              status: (valid.has(status) ? status : 'pending') as PlanStep['status'],
            }
          })
          const plan: Plan = {
            task: str(v.task),
            steps,
            updatedAt: num(v.updatedAt, at),
            ...(typeof v.reference === 'string' && v.reference.trim()
              ? { reference: v.reference }
              : {}),
            ...(Array.isArray(v.doneWhen)
              ? { doneWhen: v.doneWhen.map((x) => String(x)) }
              : {}),
          }
          return [{ kind: 'plan', at, id: `plan-${at}`, plan }]
        }
        if (name === 'loong.audit') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const raw = Array.isArray(v.items) ? v.items : []
          const items = raw.map((it) => {
            const o = (it ?? {}) as Record<string, unknown>
            return {
              criterion: str(o.criterion),
              met: o.met === true,
              evidence: str(o.evidence),
            }
          })
          const verdictRaw = str(v.verdict)
          const verdict: Audit['verdict'] =
            verdictRaw === 'met' || verdictRaw === 'not_met' ? verdictRaw : 'partial'
          return [
            {
              kind: 'audit',
              at,
              id: `audit-${at}`,
              audit: {
                verdict,
                items,
                ...(typeof v.note === 'string' ? { note: v.note } : {}),
              },
            },
          ]
        }
        if (name === 'loong.question') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const options = Array.isArray(v.options)
            ? v.options.map((o) => String(o))
            : []
          const request: QuestionRequest = {
            id: str(v.id, `q-${at}`),
            question: str(v.question),
            detail: typeof v.detail === 'string' ? v.detail : undefined,
            options,
          }
          return [{ kind: 'question', at, request }]
        }
        if (name === 'loong.notice') {
          const v = (event.value ?? {}) as Record<string, unknown>
          return [{ kind: 'notice', at, id: `notice-${at}`, text: str(v.text) }]
        }
        if (name === 'loong.run_failed') {
          /* the same failure as the error block, with the side named: the
             provider, the model, or us. A grey "run failed" is what made the
             user unable to tell — this is the fix on the reading side. */
          const v = (event.value ?? {}) as Record<string, unknown>
          return [{ kind: 'notice', at, id: `cause-${at}`, text: causeLabel(str(v.cause), str(v.model)) }]
        }
        if (name === 'loong.checks') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const ok = v.ok === true
          return [
            {
              kind: 'notice',
              at,
              id: `checks-${at}`,
              text: ok
                ? `Checks: ${str(v.label)} passed.`
                : `Checks: ${str(v.label)} failed.`,
            },
          ]
        }
        if (name === 'loong.retry') {
          /* the provider failed or answered with nothing and the runtime is
             trying again. Say so — a thread that goes quiet for four seconds
             reads as a hang. */
          const v = (event.value ?? {}) as Record<string, unknown>
          const attempt = num(v.attempt, 2)
          const of = num(v.of, 3)
          const waitMs = num(v.waitMs, 0)
          const reason = str(v.reason)
          const nextModel = str(v.nextModel)
          const seconds = waitMs >= 1000 ? `${(waitMs / 1000).toFixed(1)}s` : `${waitMs}ms`
          const because = /nothing/i.test(reason)
            ? 'the model returned nothing'
            : 'the provider refused the request'
          const moving = nextModel ? ` Trying ${nextModel} instead.` : ''
          return [
            {
              kind: 'notice',
              at,
              id: `retry-${attempt}-${at}`,
              text: `Retrying — ${because}. Attempt ${attempt} of ${of} in ${seconds}.${moving}`,
            },
          ]
        }
        if (name === 'loong.subagent') {
          const v = (event.value ?? {}) as Record<string, unknown>
          return [
            {
              kind: 'subagent',
              at,
              id: `sub-${at}-${str(v.phase, 'start')}`,
              phase: str(v.phase, 'start') === 'end' ? 'end' : 'start',
              scope: str(v.scope) === 'research' ? 'research' : 'explore',
              task: str(v.task),
            },
          ]
        }
        if (name === 'loong.screenshot') {
          const v = (event.value ?? {}) as Record<string, unknown>
          const path = str(v.path)
          if (!path) return []
          return [{ kind: 'screenshot', at, id: `shot-${at}`, path }]
        }
        return []
      }

      case 'RUN_ERROR':
        return [
          {
            kind: 'error',
            at,
            id: `err-${at}`,
            message: str(event.message, 'The run failed.'),
          },
        ]

      case 'RUN_FINISHED':
        return [{ kind: 'done', at, id: str(event.runId, 'run') }]

      default:
        /* STEP_*, STATE_*, RAW, ACTIVITY_*, SUBAGENT_* are recognised and
           intentionally ignored. A new event type must never break the view. */
        return []
    }
  }

  /** the run ended without a RUN_FINISHED — flush anything still open */
  flush(at = Date.now()): AgentEvent[] {
    const out: AgentEvent[] = []
    for (const [id, open] of this.openTools) {
      const call: ToolCall = {
        id,
        tool: asToolName(open.name),
        title: toolTitle(open.name, {}),
        input: {},
        wire: open.name,
        live: true,
      }
      out.push({ kind: 'tool_call', at, call, live: true })
    }
    this.openTools.clear()
    for (const [id, text] of this.reasoning) {
      if (text.trim()) out.push({ kind: 'thinking', at, id, text: text.trim() })
    }
    this.reasoning.clear()
    return out
  }

  reset(): void {
    this.openTools.clear()
    this.reasoning.clear()
    this.approvals.clear()
  }
}
