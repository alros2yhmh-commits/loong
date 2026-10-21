import type { AguiEvent } from './agui'

/* ---------------------------------------------------------------------------
   The transport.

   Plain HTTP to the local agent process, through the Vite origin in dev and
   directly in a packaged build. The API key never passes through here — the
   browser sends a provider name and the agent process holds the secret. That is
   the point of having a separate process at all.
   --------------------------------------------------------------------------- */

/**
 * A packaged build loads index.html over file://, where a relative "/api/..."
 * resolves against the filesystem root and every request fails. In dev the
 * interface is served by Vite and "/api" is proxied to the agent, so the base
 * stays empty.
 */
const API_BASE =
  typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? 'http://127.0.0.1:5274'
    : ''

/* ---------------------------------------------------------------------------
   The session token.

   The local agent refuses calls without it. The main process mints it at
   launch and the preload bridge is the only place the renderer can get it —
   which is the point: a page or another process cannot. In dev there is no
   bridge and the agent accepts unsigned requests, so this stays null there.
   --------------------------------------------------------------------------- */

let tokenPromise: Promise<string | null> | null = null

async function sessionToken(): Promise<string | null> {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        const bridge = (
          window as unknown as {
            loong?: { token?: () => Promise<string | null> }
          }
        ).loong
        if (!bridge?.token) return null
        return (await bridge.token()) ?? null
      } catch {
        return null
      }
    })()
  }
  return tokenPromise
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await sessionToken()
  return token ? { 'x-loong-token': token } : {}
}

export type ServerProviderId =
  | 'ollama'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'custom'

export interface ServerConfig {
  provider: ServerProviderId
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** one turn as the model must read it, tool calls and results included */
export interface HistoryTurn {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: { toolCallId: string; toolName: string; input: unknown }[]
  toolResults?: { toolCallId: string; toolName: string; output: string; ok: boolean }[]
}

export interface ServerSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  provider: string | null
  model: string | null
}

export interface ServerMessage {
  id: number
  sessionId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
}

export interface LocalModel {
  name: string
  sizeBytes: number
  family: string
  supportsTools: boolean
}

/** a row from the live OpenRouter catalogue */
export interface RemoteModel {
  id: string
  name: string
  contextLength: number
  promptPrice: string
  free: boolean
  /** whether the model can emit tool calls — the router's hard floor */
  supportsTools: boolean
  /** the model accepts image parts; false means the composer should warn */
  vision?: boolean
}

export interface Health {
  ok: boolean
  workspace: string
  ollama: { up: boolean; version?: string }
  pendingApprovals: number
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${path} returned ${res.status} with a non-JSON body.`)
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${path} failed with ${res.status}`
    throw new Error(message)
  }
  return body as T
}

export const api = {
  health: () => json<Health>('/api/health'),
  models: () => json<{ models: LocalModel[]; error?: string }>('/api/models'),
  openrouterModels: (refresh = false) =>
    json<{ models: RemoteModel[]; free?: number; error?: string }>(
      `/api/openrouter/models${refresh ? '?refresh=1' : ''}`,
    ),
  /* read-only repository view for the Review screen */
  gitStatus: () => json<{ ok: boolean; status?: string; error?: string }>('/api/git/status'),
  gitDiff: () =>
    json<{ ok: boolean; stat?: string; diff?: string; error?: string }>('/api/git/diff'),
  gitLog: () => json<{ ok: boolean; log?: string; error?: string }>('/api/git/log'),
  /* run analytics — time, tokens, outcomes, slowest tools */
  traces: () =>
    json<{
      traces: unknown[]
      stats: {
        runs: number
        ok: number
        errors: number
        aborted: number
        avgMs: number
        avgPromptTokens: number
        avgCompletionTokens: number
        slowest: { tool: string; totalMs: number; calls: number }[]
      }
    }>('/api/traces'),
  sessions: () => json<{ sessions: ServerSession[] }>('/api/sessions'),
  createSession: (input: { title?: string; provider?: string; model?: string }) =>
    json<{ session: ServerSession }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteSession: (id: string) =>
    json<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  renameSession: (id: string, title: string) =>
    json<{ session: ServerSession }>(
      `/api/sessions/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ title }) },
    ),
  messages: (id: string) =>
    json<{ messages: ServerMessage[] }>(
      `/api/sessions/${encodeURIComponent(id)}/messages`,
    ),
  approve: (id: string, approved: boolean) =>
    json<{ ok: boolean; resolved: boolean }>(
      `/api/approvals/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify({ approved }) },
    ),
  answerQuestion: (id: string, answer: string | null) =>
    json<{ ok: boolean; resolved: boolean }>(
      `/api/questions/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify({ answer }) },
    ),
  setWorkspace: (workspace: string) =>
    json<{ workspace: string }>('/api/workspace', {
      method: 'POST',
      body: JSON.stringify({ workspace }),
    }),
  checkpoints: () =>
    json<{ checkpoints: { runId: string; at: number; files: number; ops: number }[] }>(
      '/api/checkpoints',
    ),
  rewind: (runId?: string) =>
    json<{ ok: boolean; runId: string; restored: number; removed: number }>(
      '/api/checkpoints/rewind',
      { method: 'POST', body: JSON.stringify(runId ? { runId } : {}) },
    ),
  memory: () =>
    json<{ entries: { id: string; text: string; workspace: string | null; at: number }[] }>(
      '/api/memory',
    ),
  forgetMemory: (id: string) =>
    json<{ ok: boolean }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mcp: () => json<{ servers: McpServerStatus[] }>('/api/mcp'),
  mcpConfig: () => json<{ mcpServers: Record<string, McpServerSpec> }>('/api/mcp/config'),
  saveMcp: (mcpServers: Record<string, McpServerSpec>) =>
    json<{ servers: McpServerStatus[] }>('/api/mcp', {
      method: 'PUT',
      body: JSON.stringify({ mcpServers }),
    }),
  testMcp: (name: string) =>
    json<McpServerStatus>(`/api/mcp/${encodeURIComponent(name)}/test`, { method: 'POST' }),
  removeMcp: (name: string) =>
    json<{ ok: boolean }>(`/api/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

export interface McpServerSpec {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  readOnly?: boolean
  enabled?: boolean
}

export interface McpServerStatus {
  name: string
  connected: boolean
  tools: string[]
  error?: string
  transport: 'stdio' | 'http' | 'sse'
}

export interface RunRequest {
  threadId: string
  sessionId?: string
  messages: ChatMessage[]
  /** the full conversation, including tool calls and results */
  history?: HistoryTurn[]
  config: ServerConfig
  mode?: 'ask' | 'plan' | 'agent'
  /** 'auto' runs writes without stopping for a human; 'ask' gates each one */
  trust?: 'ask' | 'auto'
  /** confidence gate for full-trust writes — below the threshold they park */
  confidence?: { threshold: number; decisionModel?: string }
  /** what the reader asked to be called, from onboarding */
  userName?: string
}

export class AgentHttpError extends Error {}

/**
 * Run the agent and stream AG-UI events out as they arrive.
 *
 * The reader is deliberately hand-rolled rather than using EventSource: this is
 * a POST with a body, and EventSource only speaks GET. It also means an abort
 * tears down the socket immediately instead of leaving it half-open.
 */
export async function runAgentStream(
  req: RunRequest,
  onEvent: (event: AguiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(await authHeaders()),
    },
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `The agent refused to start (${res.status}).`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      /* keep the generic message */
    }
    throw new AgentHttpError(message)
  }
  if (!res.body) throw new AgentHttpError('The agent returned no stream.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          onEvent(JSON.parse(payload) as AguiEvent)
        } catch {
          /* a malformed frame must not kill the stream */
        }
      }
      cut = buffer.indexOf('\n\n')
    }
  }
}
