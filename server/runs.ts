import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseEvent } from '@ag-ui/core'
import type { HistoryTurn } from './engine/messages.ts'
import { DATA_DIR } from './config.ts'

export type RunStatus = 'running' | 'completed' | 'partial' | 'blocked' | 'budget_exhausted' | 'cancelled' | 'failed'
export interface RunRecord {
  id: string
  threadId: string
  sessionId?: string
  workspace: string
  provider: string
  selectedModel: string
  actualModel?: string
  mode: string
  route?: 'auto' | 'manual'
  requestId?: string
  trust: string
  status: RunStatus
  reason?: string
  createdAt: number
  updatedAt: number
  sequence: number
  settled: boolean
}
export type RunEvent = BaseEvent & { runId: string; threadId: string; sequence: number }
const statuses = new Set<RunStatus>(['running', 'completed', 'partial', 'blocked', 'budget_exhausted', 'cancelled', 'failed'])
const safeId = (id: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(id)

/** Durable history is independent from a browser connection. No credentials are stored in run metadata. */
export class RunStore {
  private records = new Map<string, RunRecord>()
  private eventCache = new Map<string, RunEvent[]>()
  private listeners = new Map<string, Set<() => void>>()
  constructor(private directory: string) {}

  private path(id: string, file: string): string {
    if (!safeId(id)) throw new Error('Invalid run ID.')
    return join(this.directory, id, file)
  }

  private save(record: RunRecord): void {
    const path = this.path(record.id, 'run.json')
    mkdirSync(join(this.directory, record.id), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
    renameSync(temporary, path)
    this.records.set(record.id, record)
  }

  create(input: Omit<RunRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'sequence' | 'settled'>): RunRecord {
    const now = Date.now()
    const record: RunRecord = { ...input, id: randomUUID(), status: 'running', createdAt: now, updatedAt: now, sequence: 0, settled: false }
    this.save(record)
    this.eventCache.set(record.id, [])
    return record
  }

  get(id: string): RunRecord | null {
    if (!safeId(id)) return null
    const current = this.records.get(id)
    if (current) return { ...current }
    try {
      const record = JSON.parse(readFileSync(this.path(id, 'run.json'), 'utf8')) as RunRecord
      if (record.id !== id || !statuses.has(record.status) || !Number.isInteger(record.sequence)) return null
      // A process restart never blindly replays an unknown external side effect.
      if (!record.settled) {
        record.sequence = this.events(id).at(-1)?.sequence ?? record.sequence
        record.status = 'blocked'
        record.reason = 'The agent process restarted. Review the last tool result and send Continue; unfinished commands were not replayed.'
        record.settled = true
        record.updatedAt = Date.now()
        this.save(record)
      } else this.records.set(id, record)
      return { ...record }
    } catch { return null }
  }

  list(threadId?: string): RunRecord[] {
    if (!existsSync(this.directory)) return []
    return readdirSync(this.directory).filter(safeId).map((id) => this.get(id))
      .filter((run): run is RunRecord => Boolean(run && (!threadId || run.threadId === threadId)))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
  }

  append(id: string, event: BaseEvent): RunEvent {
    const record = this.records.get(id)
    if (!record || record.settled) throw new Error('This run is not active.')
    const stored = { ...event, runId: id, threadId: record.threadId, sequence: record.sequence + 1 } as RunEvent
    appendFileSync(this.path(id, 'events.jsonl'), JSON.stringify(stored) + '\n', { mode: 0o600 })
    this.eventCache.get(id)?.push(stored)
    record.sequence = stored.sequence
    record.updatedAt = Date.now()
    const value = event as unknown as { type: string; name?: string; value?: { status?: RunStatus; reason?: string; model?: string }; result?: { status?: RunStatus; reason?: string; model?: string } }
    const result = value.type === 'RUN_FINISHED' ? value.result : value.name === 'loong.outcome' ? value.value : undefined
    if (result?.status && statuses.has(result.status) && result.status !== 'running') record.status = result.status
    if (result?.reason) record.reason = result.reason
    if (result?.model) record.actualModel = result.model
    if (value.type === 'RUN_ERROR') { record.status = 'failed'; record.reason = (event as unknown as { message?: string }).message }
    if (value.name === 'loong.model' && value.value?.model) record.actualModel = value.value.model
    // Token events are retained in the log; only transitions rewrite metadata.
    if (value.type === 'RUN_FINISHED' || value.type === 'RUN_ERROR' || result) this.save(record)
    this.listeners.get(id)?.forEach((notify) => notify())
    return stored
  }

  events(id: string, after = 0): RunEvent[] {
    if (!safeId(id)) return []
    const cached = this.eventCache.get(id)
    if (cached) return cached.filter((event) => event.sequence > after)
    try {
      return readFileSync(this.path(id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
        .flatMap((line) => { try { return [JSON.parse(line) as RunEvent] } catch { return [] } })
        .filter((event) => event.sequence > after)
    } catch { return [] }
  }

  checkpoint(id: string, history: HistoryTurn[]): void {
    const path = this.path(id, 'history.json')
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(history), { mode: 0o600 })
    renameSync(temporary, path)
  }

  history(id: string): HistoryTurn[] | null {
    if (!safeId(id)) return null
    try {
      const history = JSON.parse(readFileSync(this.path(id, 'history.json'), 'utf8')) as unknown
      if (!Array.isArray(history)) return null
      const record = this.get(id)
      if (record?.status === 'blocked') {
        const events = this.events(id)
        const answered = new Set(events.filter((event) => event.type === 'TOOL_CALL_RESULT').map((event) => (event as unknown as { toolCallId: string }).toolCallId))
        const unknown = events.filter((event) => event.type === 'TOOL_CALL_START' && !answered.has((event as unknown as { toolCallId: string }).toolCallId))
        if (unknown.length) history.push({ role: 'user', content: '[Interrupted execution: these tool calls started but have no recorded result. Their external effects are UNKNOWN. Inspect the workspace or external service before deciding to repeat them.]\n' + unknown.map((event) => JSON.stringify(event)).join('\n') })
      }
      return history as HistoryTurn[]
    } catch { return null }
  }

  settle(id: string, fallback: Exclude<RunStatus, 'running'> = 'partial'): void {
    const record = this.records.get(id)
    if (!record) return
    if (record.status === 'running') record.status = fallback
    record.settled = true
    record.updatedAt = Date.now()
    this.save(record)
    this.listeners.get(id)?.forEach((notify) => notify())
  }

  annotate(id: string, event: BaseEvent): void {
    const known = this.get(id)
    if (!known) return
    const record = this.records.get(id)!
    const settled = record.settled
    record.settled = false
    try { this.append(id, event) } finally { record.settled = settled; this.save(record) }
  }

  subscribe(id: string, notify: () => void): () => void {
    const list = this.listeners.get(id) ?? new Set()
    list.add(notify)
    this.listeners.set(id, list)
    return () => { list.delete(notify); if (!list.size) this.listeners.delete(id) }
  }
}

export const runStore = new RunStore(join(DATA_DIR, 'runs'))
