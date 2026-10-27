/* ===========================================================================
   The HTTP client. One place that knows the shape of the backend.

   The packaged interface loads over file://, so a relative /api/... resolves to
   file:///api/... and the app silently talks to nothing — it renders, but no
   session is created and Send does nothing. The base is therefore absolute
   whenever the document is not http.
   =========================================================================== */

export const API_BASE =
  bridge()?.apiBase ?? (typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? ''
    : 'http://127.0.0.1:5274')

type LoongBridge = {
  pickWorkspace?: () => Promise<string | null>
  openExternal?: (url: string) => void
  token?: string
  apiBase?: string
}

function bridge(): LoongBridge | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { loong?: LoongBridge }).loong
    : undefined
}

/** the session token Electron minted; empty in `npm run dev` */
export function authHeaders(): Record<string, string> {
  const token = bridge()?.token
  return token ? { 'x-loong-token': token } : {}
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) }
  const r = await fetch(API_BASE + path, { ...init, headers })
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
  tools?: boolean
  supportsTools?: boolean
  reasoning?: boolean
  contextLength?: number
  outputLimit?: number | null
  free?: boolean
  promptPrice?: string
  completionPrice?: string
}

export interface RewindResult {
  ok: boolean
  runId: string
  restored: number
  removed: number
  conflicts: { path: string; reason: string }[]
  failed: string[]
}

export interface ModelCatalogResponse {
  models: ModelInfo[]
  stale?: boolean
  error?: string
  fetchedAt?: number
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
  ok?: boolean
  error?: string
  stat?: string
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

/* The agent's plan, as it actually arrives from server/tools.ts. It used to be
   read as { title, steps[].title, status: 'running' } — none of which exist — so
   every plan rendered as a row of empty dots. */
export interface PlanStep {
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
}

export interface Plan {
  task: string
  steps: PlanStep[]
  updatedAt?: number
  /** the bar this work is measured against */
  reference?: string
  /** concrete acceptance criteria, decided before the work */
  doneWhen?: string[]
}

export interface Audit {
  verdict: 'met' | 'partial' | 'not_met'
  items: { criterion: string; met: boolean; evidence: string }[]
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  model?: string
}

export interface GraphStats {
  files: number
  sourceFiles: number
  symbols: number
  edges: number
  cycles: number
  languages: { lang: string; count: number }[]
  entries: string[]
}

export interface LedgerFinding {
  id: string
  rule: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line: number
  snippet: string
  kb: string | null
  status: 'open' | 'fixed' | 'accepted'
  firstSeenAt: number
  lastSeenAt: number
  note?: string
}

export interface FindingCounts {
  open: number
  critical: number
  high: number
  fixed: number
  accepted: number
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
  models: () => json<ModelCatalogResponse>('/api/models'),
  catalog: (provider?: string) => json<ModelCatalogResponse>(`/api/catalog/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),
  openrouterModels: () => json<ModelCatalogResponse>('/api/openrouter/models'),

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

  /* graph, findings and the security scan — the board's three reads */
  graph: (refresh = false) =>
    json<{ stats: GraphStats; map: string }>(`/api/graph${refresh ? '?refresh=1' : ''}`),
  findings: () => json<{ findings: LedgerFinding[]; counts: FindingCounts }>('/api/findings'),
  updateFinding: (id: string, status: LedgerFinding['status'], note?: string) =>
    post<{ finding: LedgerFinding; counts: FindingCounts }>(`/api/findings/${id}`, { status, note }),
  securityScan: () =>
    post<{ findings: Omit<LedgerFinding, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt'>[]; counts: FindingCounts }>(
      '/api/security/scan',
    ),

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
  files: (path: string, signal?: AbortSignal) =>
    json<{ content: string }>(`/api/files?path=${encodeURIComponent(path)}`, { signal }),
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
  gitDiff: (signal?: AbortSignal) => json<GitDiff>('/api/git/diff', { signal }),
  gitLog: () => json<{ commits: unknown[] }>('/api/git/log'),
  checkpoints: () => json<{ checkpoints: Checkpoint[] }>('/api/checkpoints'),
  rewind: (runId: string) => post<RewindResult>('/api/checkpoints/rewind', { runId }),
  traces: () => json<{ traces: TraceRow[] }>('/api/traces'),
  health: () =>
    json<{ ok: boolean; ollama?: { up: boolean }; workspace: string | null }>('/api/health'),
}

/** the native bridge, when the app runs inside the desktop shell */
export { bridge as loongBridge }
