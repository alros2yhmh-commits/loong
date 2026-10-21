/* ---------------------------------------------------------------------------
   The contract.

   This file is the seam. The interface above it renders these shapes and
   nothing else; the runtime below it — today a recorded fixture, tomorrow the
   real model and tools — produces these shapes and nothing else. Freeze this
   first and the UI never has to be rebuilt when the engine lands.

   If you find yourself wanting to add a field to make a screen look nicer,
   that is the signal that the screen is wrong, not the contract.
   --------------------------------------------------------------------------- */

export type AgentPhase =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool'
  | 'awaiting'
  | 'error'
  | 'done'

export type ToolName =
  | 'read_file'
  | 'grep'
  | 'shell'
  | 'write_file'
  | 'web_search'

export interface ToolCall {
  id: string
  tool: ToolName
  /** short human title, e.g. "src/lib/sound.ts" */
  title: string
  /** the arguments as the model emitted them */
  input: Record<string, unknown>
  /** the true tool name from the runtime, for cards that need it */
  wire?: string
  /** the call has started but not finished — the card shows progress */
  live?: boolean
}

export interface ToolResult {
  id: string
  ok: boolean
  output: string
  ms: number
}

export interface Session {
  id: string
  title: string
  preview: string
  age: string
  pinned?: boolean
}

/** The agent has stopped and is waiting on a human before it does something it
    cannot undo. This is the one event the interface must never bury. */
export interface ApprovalRequest {
  id: string
  tool: ToolName
  /** the tool's real name — MCP tools are `mcp__server__tool`, which the five
      icon families cannot express on their own */
  wire?: string
  title: string
  detail: string
  /** the change itself, when the tool sent one — rendered as a real diff */
  files?: { path: string; before: string | null; after: string }[]
}

export type ApprovalDecision = 'approve' | 'deny'

/** Every event carries a wall-clock stamp. Ordering is by `at`, never by arrival. */
export type AgentEvent =
  | { kind: 'session'; at: number; id: string; title: string }
  | { kind: 'user'; at: number; id: string; text: string; images?: string[] }
  | { kind: 'thinking'; at: number; id: string; text: string; live?: boolean }
  | { kind: 'token'; at: number; id: string; text: string }
  | { kind: 'message'; at: number; id: string; text: string }
  | { kind: 'tool_call'; at: number; call: ToolCall; live?: boolean }
  | { kind: 'tool_args'; at: number; id: string; delta: string }
  | { kind: 'tool_result'; at: number; result: ToolResult }
  /** how long a tool actually ran — the timeline reads this, the card's timer
      stops when the result lands but the number is what the reader compares */
  | { kind: 'tool_duration'; at: number; id: string; ms: number }
  | { kind: 'approval'; at: number; request: ApprovalRequest }
  /** something the runtime did that the reader should know about but that is
      not a failure — a retry, most often. Never styled as an error. */
  | { kind: 'notice'; at: number; id: string; text: string }
  | { kind: 'plan'; at: number; id: string; plan: Plan }
  /** the agent checked its own work against the criteria it committed to */
  | { kind: 'audit'; at: number; id: string; audit: Audit }
  | { kind: 'question'; at: number; request: QuestionRequest }
  | { kind: 'question_answered'; at: number; id: string; answer: string | null }
  /** a child agent was delegated a read-only job and came back with findings */
  | {
      kind: 'subagent'
      at: number
      id: string
      phase: 'start' | 'end'
      scope: 'explore' | 'research'
      task: string
    }
  /** the agent took a screenshot of a page it is driving */
  | { kind: 'screenshot'; at: number; id: string; path: string }
  | { kind: 'error'; at: number; id: string; message: string; detail?: string }
  | { kind: 'done'; at: number; id: string }

export type AgentEventKind = AgentEvent['kind']

/** an ordered checklist the agent writes and keeps current as it works */
export interface PlanStep {
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
}

export interface Plan {
  task: string
  steps: PlanStep[]
  updatedAt: number
  /** the bar this work is measured against — a named product, pattern or doc */
  reference?: string
  /** concrete acceptance criteria, decided before the work starts */
  doneWhen?: string[]
}

/** one criterion, judged against the evidence rather than the intention */
export interface AuditItem {
  criterion: string
  met: boolean
  /** the file, test, command or screenshot that proves it */
  evidence: string
}

export interface Audit {
  verdict: 'met' | 'partial' | 'not_met'
  items: AuditItem[]
  note?: string
}

/** the one thing an agent must be able to do that is not a tool call: ask */
export interface QuestionRequest {
  id: string
  question: string
  detail?: string
  options: string[]
}
