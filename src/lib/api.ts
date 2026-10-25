/* ===========================================================================
   The HTTP client. One place that knows the shape of the backend.

   The packaged interface loads over file://, so a relative /api/... resolves to
   file:///api/... and the app silently talks to nothing — it renders, but no
   session is created and Send does nothing. The base is therefore absolute
   whenever the document is not http.
   =========================================================================== */

const API_BASE =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? ''
    : 'http://127.0.0.1:5274'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_BASE + path, init)
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${r.status} ${r.statusText}`)
  }
  return (await r.json()) as T
}

const post = <T,>(path: string, body?: unknown) =>
  json<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

/* ---- the shapes the interface consumes ---------------------------------- */

export interface Settings {
  provider: string
  model: string
  route: 'auto' | 'manual'
  mode: 'ask' | 'plan' | 'agent'
  trust: 'ask' | 'auto'
  soundEnabled: boolean
  volume: number
  reducedMotion: boolean
  fontSize: number
  view: 'normal' | 'thinking' | 'verbose'
  userName: string
}

export interface FolderPrefs {
  mode?: 'ask' | 'plan' | 'agent'
  trust?: 'ask' | 'auto'
}

export interface SessionRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  workspace: string | null
}

export interface ModelInfo {
  /** hosted providers answer with `id`; a local ollama answers with `name` */
  id: string
  name?: string
  label?: string
  vision?: boolean | null
  context?: number | null
  price?: { prompt?: number; completion?: number } | null
}

export interface ProviderInfo {
  id: string
  label: string
  configured?: boolean
}

export interface ToolInfo {
  name: string
  access: 'read' | 'write' | 'ask' | 'plan'
  summary: string
}

export interface MemoryEntry {
  id: string
  text: string
  workspace: string | null
  at: number
}

export interface SkillInfo {
  name: string
  title?: string
  summary?: string
}

export interface LibraryTopic {
  id: string
  title: string
  summary: string
}

export interface TimerInfo {
  id: string
  title?: string
  prompt: string
  afterMs?: number
  at?: number
}

export interface GitStatus {
  branch?: string
  clean?: boolean
  changed?: { path: string; status: string }[]
  ahead?: number
  behind?: number
}

export interface GitDiff {
  diff?: string
  files?: { path: string; added: number; removed: number }[]
}

export interface Checkpoint {
  runId: string
  at: number
  label?: string
}

export interface TraceRow {
  runId: string
  at: number
  model?: string
  status?: string
  steps?: number
}

export interface ApprovalRequest {
  id: string
  tool: string
  wire: string
  title: string
  detail: string
  files?: unknown
}

export interface QuestionRequest {
  id: string
  question: string
  detail?: string
  options?: string[]
}

export interface PlanStep {
  title: string
  detail?: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

export interface Plan {
  title?: string
  steps: PlanStep[]
}

export interface Audit {
  title?: string
  findings?: { label: string; ok: boolean; detail?: string }[]
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  model?: string
}

export const api = {
  /* settings */
  getSettings: () => json<{ settings: Settings; folders: FolderPrefs }>('/api/settings'),
  putSettings: (body: { settings?: Partial<Settings>; folders?: FolderPrefs }) =>
    json<{ settings: Settings }>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /* sessions */
  sessions: () => json<{ sessions: SessionRow[] }>('/api/sessions'),
  createSession: (workspace?: string) =>
    post<{ session: SessionRow }>('/api/sessions', workspace ? { workspace } : {}),
  renameSession: (id: string, title: string) =>
    json<{ ok: boolean }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  deleteSession: (id: string) =>
    json<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  forkSession: (id: string) => post<{ session: SessionRow }>(`/api/sessions/${id}/fork`),
  messages: (id: string) =>
    json<{ messages: { role: string; content: string }[] }>(`/api/sessions/${id}/messages`),
  sessionState: (id: string) =>
    json<{ id: string; blocks: number; running: boolean; plan: { done: number; total: number } | null }>(
      `/api/sessions/${id}/state`,
    ),

  /* blocks — the transcript's source of truth */
  loadBlocks: (id: string) =>
    json<{ blocks: unknown[] }>(`/api/threads/${id}/blocks`).then((r) => r.blocks ?? []),
  saveBlocks: (id: string, blocks: unknown[]) =>
    json<{ ok: boolean }>(`/api/threads/${id}/blocks`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: blocks.slice(0, 5000) }),
    }),

  /* workspace */
  workspace: () => json<{ workspace: string | null }>('/api/workspace'),
  setWorkspace: (workspace: string) =>
    json<{ workspace: string }>('/api/workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace }),
    }),

  /* models */
  providers: () => json<{ providers: ProviderInfo[] }>('/api/providers'),
  models: () => json<{ models: ModelInfo[] }>('/api/models'),
  catalog: () => json<{ models: ModelInfo[] }>('/api/catalog/models'),
  openrouterModels: () => json<{ models: ModelInfo[] }>('/api/openrouter/models'),

  /* keys — the interface may set one and ask whether one is set, never read one */
  keys: () => json<{ keys: Record<string, { set: boolean; hint: string; baseUrl: string }> }>('/api/keys'),
  putKeys: (body: { keys?: Record<string, string>; baseUrls?: Record<string, string> }) =>
    json<{ keys: Record<string, { set: boolean; hint: string; baseUrl: string }> }>('/api/keys', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /* tools */
  tools: () => json<{ tools: ToolInfo[] }>('/api/tools'),

  /* approvals and questions */
  approvals: () => json<{ approvals: ApprovalRequest[] }>('/api/approvals'),
  decide: (id: string, approved: boolean) =>
    json<{ ok: boolean }>(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved }),
    }),
  questions: () => json<{ questions: QuestionRequest[] }>('/api/questions'),
  answer: (id: string, answer: string | null) =>
    json<{ ok: boolean }>(`/api/questions/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer }),
    }),

  /* files */
  tree: () => json<{ tree: unknown }>('/api/tree'),
  files: (path: string) =>
    json<{ content: string }>(`/api/files?path=${encodeURIComponent(path)}`),
  shotUrl: (name: string) => `${API_BASE}/api/shots/${encodeURIComponent(name)}`,

  /* memory, skills, library */
  memory: () => json<{ entries: MemoryEntry[] }>('/api/memory'),
  forgetMemory: (id: string) =>
    json<{ ok: boolean }>(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  skills: () => json<{ skills: SkillInfo[] }>('/api/skills'),
  library: () => json<{ topics: LibraryTopic[] }>('/api/library'),

  /* integrations + mcp */
  integrations: () => json<{ integrations: unknown[] }>('/api/integrations'),
  mcp: () => json<{ servers: unknown[] }>('/api/mcp'),

  /* timers */
  timers: () => json<{ timers: TimerInfo[]; pending?: TimerInfo[] }>('/api/timers'),
  addTimer: (body: { prompt: string; title?: string; after?: string }) =>
    post<{ timer: TimerInfo }>('/api/timers', body),
  cancelTimer: (id: string) => json<{ ok: boolean }>(`/api/timers/${id}`, { method: 'DELETE' }),

  /* git, checkpoints, traces */
  gitStatus: () => json<GitStatus>('/api/git/status'),
  gitDiff: () => json<GitDiff>('/api/git/diff'),
  gitLog: () => json<{ commits: unknown[] }>('/api/git/log'),
  checkpoints: () => json<{ checkpoints: Checkpoint[] }>('/api/checkpoints'),
  traces: () => json<{ traces: TraceRow[] }>('/api/traces'),
  health: () =>
    json<{ ok: boolean; ollama?: { up: boolean }; workspace: string | null }>('/api/health'),
}

/** the native bridge, when the app runs inside the desktop shell */
export const bridge = () =>
  (window as unknown as { loong?: { pickWorkspace?: () => Promise<string | null> } }).loong
