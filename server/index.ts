import { runStore, type RunRecord } from './runs.ts'
import { cancelRunApprovals, cancelRunQuestions } from './approvals.ts'
import { killShell } from './pty.ts'
import { stopProject } from './project-run.ts'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { bodyLimit } from 'hono/body-limit'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join, relative } from 'node:path'
import type { BaseEvent } from '@ag-ui/core'
import { EventEncoder } from '@ag-ui/encoder'
import {
  getWorkspace,
  haveWorkspace,
  setWorkspace,
  withRunWorkspace,
  setCapabilities,
  type Capabilities,
} from './config.ts'
import { shotsDir } from './browser.ts'
import { listCheckpoints, rewindLastRun, rewindRun } from './journal.ts'
import { listTraces, traceFor, traceStats } from './trace.ts'
import { runWithRunId, sessionWithId } from './run-context.ts'
import { forget, listMemory } from './memory.ts'
import { forgetProfileFact, readProfile, setProfileName } from './profile.ts'
import { listDigests } from './digest.ts'
import { peersFor, formatPeers, readInbox, unreadCount } from './bus.ts'
import { listServers, stopServer } from './servers.ts'
import {
  assertSafeMcpConfig,
  disconnectAll,
  loadMcpConfig,
  maskMcpConfig,
  mcpStatus,
  removeMcpServer,
  saveMcpConfig,
  testMcpServer,
  unmaskMcpConfig,
  type McpServerSpec,
} from './mcp.ts'
import { runAgent, type ChatMessage, type AgentMode, type HistoryTurn } from './agent.ts'
import { PROVIDERS, listLocalModels, listOpenRouterModels, openRouterCatalogStatus, probeOllama, type ProviderConfig } from './providers.ts'
import {
  appendMessage,
  autoTitle,
  createSession,
  deleteSession,
  getMessages,
  getSession,
  listSessions,
  renameSession,
} from './db.ts'
import { loadBlocks, saveBlocks, deleteBlocks } from './threads.ts'
import { loadCatalog, modelsOf, catalogStatus } from './catalog.ts'
import { INTEGRATIONS, configuredIntegrations, connectIntegration, disconnectIntegration } from './integrations.ts'
import { ackTimer, addTimer, cancelTimer, fireDue, listTimers, parseDelay, pendingTimers } from './timers.ts'
import type { ProviderId } from './providers.ts'
import { pendingApprovals, resolveApproval, pendingQuestions, resolveQuestion } from './approvals.ts'
import { getSettings, putSettings, getFolderPrefs, putFolderPrefs } from './settings.ts'
import { pendingHooks, trustHooks, untrustHooks } from './hooks.ts'
import { KEY_PROVIDERS, keyStatus, setBaseUrl, setKey } from './keys.ts'
import { indexWorkspace, mapReport, statsOf } from './graph.ts'
import { counts as findingCounts, listFindings, recordFindings, updateFinding } from './findings.ts'
import { scanWorkspace } from './security-gate.ts'

/* ---------------------------------------------------------------------------
   The local agent server.

   It runs on the user's machine, next to the app, and it is the only thing that
   ever sees an API key. The browser talks to it over plain HTTP on loopback.
   That boundary is the whole reason this is a separate process: a renderer that
   holds your keys is a renderer that can leak them.
   --------------------------------------------------------------------------- */

const app = new Hono()

/* ---------------------------------------------------------------------------
   Who may call this server.

   Bound to loopback it is still reachable by every other process on the
   machine, and by any web page that can make the browser send a request to
   127.0.0.1 — which is why CORS is not a security boundary and "it is local"
   is not authentication. The app therefore carries a token the main process
   mints at launch and hands to the renderer through the preload bridge; a
   request without it is refused, whoever sent it.

   In dev (`npm run dev` with no Electron) there is no bridge to carry the
   token, so the server accepts unsigned requests — localhost-only, no secrets
   beyond the operator's own keys.
   --------------------------------------------------------------------------- */

const SESSION_TOKEN = process.env.LOONG_TOKEN ?? ''

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5273',
  'http://127.0.0.1:5273',
  'http://localhost:5274',
  'http://127.0.0.1:5274',
  'tauri://localhost',
  'https://tauri.localhost',
  'loong://app',
  /* 'null' is deliberately absent: a sandboxed iframe or data:/blob: context
     presents Origin: null, and the app ships no iframes, so allowing it would
     only widen the surface for a page that can drive the local agent. */
])

/* The address of whoever opened the socket — not a header they chose. The node
   adapter hands the raw request in `c.env.incoming`; anything without a socket
   (a test calling `app.request`) reads as an empty peer and is treated as local
   by the dev branch below, which is exactly what the tests are. */
type NodePeer = {
  incoming?: {
    socket?: { remoteAddress?: string }
    connection?: { remoteAddress?: string }
  }
}

function peerAddress(c: { env: unknown }): string {
  const env = c.env as NodePeer | undefined
  const socket = env?.incoming?.socket ?? env?.incoming?.connection
  return String(socket?.remoteAddress ?? '')
}

/** 127.0.0.0/8 and ::1 — this machine, and nothing else */
export function isLoopbackPeer(address: string): boolean {
  if (!address) return false
  if (address === '::1') return true
  if (address.startsWith('::ffff:')) return isLoopbackPeer(address.slice(7))
  /* four octets, each 0-255, first one 127. A bare /^127\./ would also accept
     the hostname "127.evil.com", and a hostname here would mean something
     upstream is passing a name where a socket address belongs. */
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  return m !== null && m.slice(1).every((o) => Number(o) <= 255)
}

/* Token + origin gate. Runs before CORS: a request that fails here never
   reaches a route. The token rides in a header the preload bridge adds;
   the origin check is the second wall against DNS-rebinding-style pages.

   The dev branch is the one that had to change. "No token configured" used to
   mean "accept everyone", and this process runs shell commands — so a laptop on
   a café Wi-Fi was an unauthenticated agent for anyone on that network. With no
   token, an unsigned request is now accepted only from loopback. */
app.use('*', async (c, next) => {
  const peer = peerAddress(c)
  const origin = c.req.header('origin')
  if (c.req.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return c.json({ error: 'Origin not allowed.' }, 403)
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'content-type, accept, x-loong-token, last-event-id')
    c.header('Vary', 'Origin')
    return c.body(null, 204)
  }
  if (SESSION_TOKEN) {
    /* screenshots are <img src> — they cannot send a header. Loopback + a
       generated filename is the whole allowance; anything else still needs the token. */
    const shot = c.req.path.startsWith('/api/shots/') && isLoopbackPeer(peer || '127.0.0.1')
    if (!shot && c.req.header('x-loong-token') !== SESSION_TOKEN) {
      return c.json({ error: 'This local agent requires its session token.' }, 401)
    }
  } else if (peer && !isLoopbackPeer(peer)) {
    return c.json(
      { error: 'This agent accepts unsigned requests from this machine only.' },
      403,
    )
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return c.json({ error: 'Origin not allowed.' }, 403)
  }
  await next()
})

app.use(
  '*',
  cors({
    origin: (o) => (o && ALLOWED_ORIGINS.has(o) ? o : null),
    allowHeaders: ['content-type', 'accept', 'x-loong-token', 'last-event-id'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  }),
)

/* 8MB: a thread snapshot carries the run — tool outputs, diffs, plans. The
   socket is loopback and token-gated, so the guard is against accidents. */
app.use('*', bodyLimit({ maxSize: 8 * 1024 * 1024 }))

/* ---- rate limiting ----------------------------------------------------- */

const RATE_WINDOW_MS = 60_000
const RATE_MAX_RUNS = 20
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (list.length >= RATE_MAX_RUNS) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  return false
}

/* The rate-limit key is the socket address, never `x-forwarded-for`: that header
   is written by whoever is asking, so keying on it gave an attacker a fresh
   bucket on every request — a limiter that only limited the honest. */
function clientIp(c: { env: unknown }): string {
  return peerAddress(c) || 'local'
}

/* ---- health ------------------------------------------------------------ */

app.get('/api/health', async (c) => {
  const ollama = await probeOllama()
  return c.json({
    ok: true,
    workspace: haveWorkspace() ? getWorkspace() : null,
    ollama,
    pendingApprovals: pendingApprovals().length,
    pendingQuestions: pendingQuestions().length,
  })
})

/* ---- workspace --------------------------------------------------------- */

app.get('/api/workspace', (c) => {
  /* null means "nothing is open yet" — the interface shows the picker instead
     of pretending the process's own folder is the project */
  return c.json({ workspace: haveWorkspace() ? getWorkspace() : null })
})

/* The tools the agent can reach, published so the interface does not hardcode
   a list that will drift. Mirrors the set the agent assembles in agent.ts. */
const TOOL_MANIFEST = [
  { name: 'list_dir', access: 'read', summary: 'List a directory inside the workspace' },
  { name: 'read_file', access: 'read', summary: 'Read a text file, with line numbers' },
  { name: 'grep', access: 'read', summary: 'Search file contents with a regular expression' },
  { name: 'fetch_url', access: 'read', summary: 'Fetch a URL and return its text' },
  { name: 'web_search', access: 'read', summary: 'Search the web (brave, duckduckgo, searxng, tavily)' },
  { name: 'recall', access: 'read', summary: 'Read the library' },
  { name: 'read_document', access: 'read', summary: 'Read a document from the library' },
  { name: 'thinking', access: 'read', summary: 'Think before acting' },
  { name: 'write_file', access: 'write', summary: 'Create or overwrite a file — asks first' },
  { name: 'edit_file', access: 'write', summary: 'Replace text in a file — asks first' },
  { name: 'multi_edit', access: 'write', summary: 'Several edits in one call — asks first' },
  { name: 'mkdir', access: 'write', summary: 'Create a directory — asks first' },
  { name: 'delete_file', access: 'write', summary: 'Delete a file or directory — asks first' },
  { name: 'move_file', access: 'write', summary: 'Move or rename — asks first' },
  { name: 'shell', access: 'write', summary: 'Run a command in the workspace — asks first' },
  { name: 'propose_changes', access: 'write', summary: 'Propose files and submit them for approval' },
  { name: 'ask_user', access: 'ask', summary: 'Ask the reader a question and wait' },
  { name: 'plan', access: 'plan', summary: 'Propose a plan without editing anything' },
  { name: 'audit', access: 'plan', summary: 'Audit the work against the request' },
  { name: 'browser', access: 'write', summary: 'Drive a browser to verify a change' },
  { name: 'task', access: 'read', summary: 'Delegate one read-only research job to a child agent' },
  { name: 'task_many', access: 'read', summary: 'Fan out up to 30 read-only child agents in one call' },
  { name: 'agent_peers', access: 'read', summary: 'List the other sessions running on this machine' },
  { name: 'agent_inbox', access: 'read', summary: 'Read messages other sessions sent to this one' },
  { name: 'agent_message', access: 'write', summary: 'Message another session, or reply to it' },
  { name: 'remember_user', access: 'write', summary: 'Keep a durable fact about the user' },
  { name: 'user_profile', access: 'read', summary: 'Show, name or forget what is known about the user' },
  { name: 'recent_work', access: 'read', summary: 'What earlier sessions on this machine concluded' },
  { name: 'desktop', access: 'write', summary: 'Open apps, focus windows, click, type, screenshot — asks first' },
  { name: 'server_start', access: 'write', summary: 'Start a long-lived dev server with a readable log' },
  { name: 'server_logs', access: 'read', summary: 'Read the tail of a managed dev server log' },
  { name: 'server_stop', access: 'write', summary: 'Stop a managed dev server and its child processes' },
  { name: 'server_list', access: 'read', summary: 'List the dev servers Loong is managing' },
]

/* ---- live runs ------------------------------------------------------------
   A run's state used to exist only inside its SSE stream, so a restored
   session showed nothing until the next run started. The set is the smallest
   honest fix: the id is added when the stream opens and removed when it
   closes, and /api/sessions/:id/state reads it. */
const liveThreads = new Set<string>()

/* ---- settings (G1) ------------------------------------------------------
   The reader's preferences, persisted. These lived in the browser's
   localStorage until the interface was rebuilt; a preference that does not
   survive a restart is not a preference. The permission mode is remembered
   per folder, except Plan, which is session-only. */

app.get('/api/settings', (c) =>
  c.json({ settings: getSettings(), folders: getFolderPrefs(getWorkspace()) }),
)

app.put('/api/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const folders = (body as { folders?: unknown }).folders
  if (folders && typeof folders === 'object') {
    const prefs = folders as { mode?: unknown; trust?: unknown }
    putFolderPrefs(getWorkspace(), {
      mode: prefs.mode === 'ask' || prefs.mode === 'agent' ? prefs.mode : undefined,
      trust: prefs.trust === 'auto' ? 'auto' : prefs.trust === 'ask' ? 'ask' : undefined,
    })
  }
  return c.json({ settings: putSettings((body as { settings?: unknown }).settings) })
})

/* ---- keys --------------------------------------------------------------
   The renderer may set a key and may ask whether one is set. It may never
   read one back: GET returns a masked hint, which is enough to recognise
   your own key and useless to anyone who steals it. */
app.get('/api/keys', (c) => c.json({ keys: keyStatus() }))

app.put('/api/keys', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    keys?: Record<string, unknown>
    baseUrls?: Record<string, unknown>
  }
  const next = body.keys ?? {}
  for (const p of KEY_PROVIDERS) {
    if (typeof next[p] === 'string') setKey(p, next[p] as string)
  }
  const urls = body.baseUrls ?? {}
  for (const p of KEY_PROVIDERS) {
    if (typeof urls[p] === 'string') setBaseUrl(p, urls[p] as string)
  }
  return c.json({ keys: keyStatus() })
})

/* ---- tools (G3) ---------------------------------------------------------
   What the agent can actually do, so the interface does not have to hardcode
   a list that will drift. */

app.get('/api/tools', (c) => c.json({ tools: TOOL_MANIFEST }))

/* ---- graph (G6) ---------------------------------------------------------
   The repository as a graph. The interface can show what the agent indexed
   without spending a run on it, and `?refresh=1` is the one manual rebuild. */

app.get('/api/graph', async (c) => {
  if (!haveWorkspace()) return c.json({ error: 'No folder is open.' }, 400)
  const graph = await indexWorkspace(c.req.query('refresh') === '1' ? { force: true } : {})
  return c.json({ stats: statsOf(graph), map: mapReport(graph) })
})

/* ---- findings (G7) ------------------------------------------------------
   The security ledger, so the board survives a reload and a finding can be
   closed from the interface without asking the model to do it. */

app.get('/api/findings', (c) => c.json({ findings: listFindings(), counts: findingCounts() }))

app.post('/api/findings/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const status =
    body.status === 'fixed' || body.status === 'accepted' || body.status === 'open' ? body.status : null
  if (!status) return c.json({ error: 'status must be open, fixed or accepted' }, 400)
  const hit = updateFinding(
    c.req.param('id'),
    status,
    typeof body.note === 'string' ? body.note : undefined,
  )
  if (!hit) return c.json({ error: 'no such finding' }, 404)
  return c.json({ finding: hit, counts: findingCounts() })
})

app.post('/api/security/scan', async (c) => {
  if (!haveWorkspace()) return c.json({ error: 'No folder is open.' }, 400)
  const findings = await scanWorkspace({ maxFiles: 300 })
  const recorded = recordFindings(findings)
  return c.json({ findings: findings.slice(0, 80), counts: recorded })
})

/* ---- session state (G5) ------------------------------------------------
   What a restored session is doing, so a reload is not a blank screen. */

app.get('/api/sessions/:id/state', (c) => {
  const id = c.req.param('id')
  const raw = loadBlocks(id) ?? []
  const blocks = raw as { k?: string; plan?: { steps?: { status?: string }[] } }[]
  const plan = [...blocks].reverse().find((b) => b.k === 'plan')
  const steps = plan?.plan?.steps ?? []
  return c.json({
    id,
    blocks: blocks.length,
    running: liveThreads.has(id),
    plan: plan ? { done: steps.filter((x) => x.status === 'done').length, total: steps.length } : null,
  })
})

app.post('/api/workspace', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const next = body.workspace?.trim()
  if (!next) return c.json({ error: 'workspace is required' }, 400)
  if (!isAbsolute(next)) {
    return c.json({ error: 'Send an absolute path, not a relative one.' }, 400)
  }
  try {
    const set = setWorkspace(next)
    return c.json({ workspace: set })
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
})

/* ---- questions --------------------------------------------------------- */

app.get('/api/questions', (c) => c.json({ questions: pendingQuestions() }))

app.post('/api/questions/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = resolveQuestion(c.req.param('id'), body.answer ?? null)
  return c.json({ ok, resolved: ok })
})

/* ---- providers --------------------------------------------------------- */

app.get('/api/providers', (c) => c.json({ providers: PROVIDERS }))

app.get('/api/models', async (c) => {
  try {
    return c.json({ models: await listLocalModels() })
  } catch (err) {
    return c.json({ models: [], error: (err as Error).message }, 200)
  }
})

/* ---- the model catalog: every provider's models, with what they can do --- */

app.get('/api/catalog/models', async (c) => {
  const provider = (c.req.query('provider') ?? 'openrouter') as ProviderId
  try {
    const catalog = await loadCatalog()
    const models = modelsOf(catalog, provider).filter((m) => m.tools)
    return c.json({ provider, models, count: models.length, ...catalogStatus() })
  } catch (e) {
    /* an offline machine keeps the manual field: the list is a convenience,
       never a requirement */
    return c.json({ provider, models: [], error: (e as Error).message })
  }
})

app.get('/api/openrouter/models', async (c) => {
  try {
    const force = c.req.query('refresh') === '1'
    const models = await listOpenRouterModels(force)
    return c.json({ models, free: models.filter((m) => m.free).length, ...openRouterCatalogStatus() })
  } catch (err) {
    return c.json({ models: [], error: (err as Error).message }, 200)
  }
})

/* ---- sessions ---------------------------------------------------------- */

app.get('/api/sessions', (c) => c.json({ sessions: listSessions() }))

app.post('/api/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return c.json({ session: createSession(body) }, 201)
})

app.delete('/api/sessions/:id', (c) => {
  deleteSession(c.req.param('id'))
  deleteBlocks(c.req.param('id'))
  return c.json({ ok: true })
})

/* ---- the workspace, as a tree ------------------------------------------- */

app.get('/api/tree', async (c) => {
  const depth = Math.min(4, Math.max(1, Number(c.req.query('depth') ?? 2)))
  try {
    const root = getWorkspace()
    const walk = async (dir: string, level: number): Promise<unknown[]> => {
      if (level > depth) return []
      const { readdir } = await import('node:fs/promises')
      let entries: { name: string; isDirectory(): boolean }[] = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return []
      }
      const out: unknown[] = []
      for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') && entry.name !== '.loong') continue
        if (['node_modules', 'dist', 'build', 'out', '.git', '__pycache__', '.venv'].includes(entry.name)) continue
        const full = join(dir, entry.name)
        out.push({
          name: entry.name,
          dir: entry.isDirectory(),
          children: entry.isDirectory() ? await walk(full, level + 1) : undefined,
        })
        if (out.length >= 120) break
      }
      return out
    }
    return c.json({ root, tree: await walk(root, 1) })
  } catch (e) {
    return c.json({ root: '', tree: [], error: (e as Error).message })
  }
})

/* ---- the agent's own inventory: skills, library, version ----------------- */

app.get('/api/skills', async (c) => {
  const { listSkills } = await import('./skills.ts')
  return c.json({
    skills: listSkills().map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      chars: s.body.length,
      source: s.source,
    })),
  })
})

app.get('/api/skills/:name', async (c) => {
  const { listSkills } = await import('./skills.ts')
  const found = listSkills().find((s) => s.name.toLowerCase() === c.req.param('name').toLowerCase())
  return found ? c.json(found) : c.json({ error: 'no such skill' }, 404)
})

app.get('/api/library', async (c) => {
  const { listTopics } = await import('./library.ts')
  return c.json({
    topics: listTopics().map((t) => ({ id: t.id, title: t.title, summary: t.summary, chars: t.body.length })),
  })
})

app.get('/api/library/:id', async (c) => {
  const { readTopic } = await import('./library.ts')
  const topic = readTopic(c.req.param('id'))
  return topic ? c.json(topic) : c.json({ error: 'no such topic' }, 404)
})

/* ---- integrations: a gallery, not a JSON form --------------------------- */

app.get('/api/integrations', (c) =>
  c.json({ integrations: INTEGRATIONS, configured: configuredIntegrations() }),
)

app.post('/api/integrations/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = connectIntegration(c.req.param('id'), body?.values)
  return result.ok ? c.json(result) : c.json(result, 400)
})

app.delete('/api/integrations/:id', (c) =>
  c.json(disconnectIntegration(c.req.param('id'))),
)

/* ---- timers ------------------------------------------------------------- */

app.get('/api/timers', (c) =>
  c.json({ timers: listTimers(), pending: pendingTimers() }),
)

app.post('/api/timers', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const afterMs = typeof body.afterMs === 'number' ? body.afterMs : parseDelay(String(body.after ?? ''))
  if (!afterMs) return c.json({ error: 'say when: 3m, 90s, 2h' }, 400)
  const timer = addTimer({ afterMs, prompt: String(body.prompt ?? ''), title: body.title })
  if ('error' in timer) return c.json(timer, 400)
  return c.json({ timer }, 201)
})

app.delete('/api/timers/:id', (c) =>
  c.json({ ok: cancelTimer(c.req.param('id')) }),
)

app.post('/api/timers/:id/ack', (c) => {
  ackTimer(c.req.param('id'))
  return c.json({ ok: true })
})

/* the tick: a timer that came due while the app was open fires here */
setInterval(() => {
  try {
    fireDue()
  } catch {
    /* a broken timer file must not take the agent down */
  }
}, 10_000).unref?.()

/* ---- thread snapshots: the run itself, not just the conversation --------- */

/* fork a thread: the conversation, its messages and its run, under a new id.
   OpenCode settled this — a thread you want to try a different approach on is
   a COPY, never an edit of the original. */
app.post('/api/sessions/:id/fork', (c) => {
  const id = c.req.param('id')
  const src = getSession(id)
  if (!src) return c.json({ error: 'no such session' }, 404)
  const copy = createSession({
    title: `${src.title} (fork)`.slice(0, 80),
    provider: src.provider ?? undefined,
    model: src.model ?? undefined,
    workspace: src.workspace ?? undefined,
  })
  for (const m of getMessages(id)) {
    appendMessage({ sessionId: copy.id, role: m.role, content: m.content })
  }
  const blocks = loadBlocks(id)
  if (blocks) saveBlocks(copy.id, blocks)
  return c.json({ session: copy }, 201)
})

app.get('/api/threads/:id/blocks', (c) => {
  const id = c.req.param('id')
  if (!getSession(id)) return c.json({ error: 'no such session' }, 404)
  const blocks = loadBlocks(id)
  return blocks ? c.json({ blocks }) : c.json({ blocks: null })
})

app.put('/api/threads/:id/blocks', async (c) => {
  const id = c.req.param('id')
  if (!getSession(id)) return c.json({ error: 'no such session' }, 404)
  const body = await c.req.json().catch(() => null)
  if (!body || !Array.isArray(body.blocks)) return c.json({ error: 'blocks must be an array' }, 400)
  saveBlocks(id, body.blocks.slice(0, 5000))
  return c.json({ ok: true })
})

app.get('/api/sessions/:id/messages', (c) => {
  const id = c.req.param('id')
  if (!getSession(id)) return c.json({ error: 'no such session' }, 404)
  return c.json({ messages: getMessages(id) })
})

app.patch('/api/sessions/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = c.req.param('id')
  if (!getSession(id)) return c.json({ error: 'no such session' }, 404)
  const title = body.title?.trim().slice(0, 120)
  if (!title) return c.json({ error: 'title is required' }, 400)
  renameSession(id, title)
  return c.json({ session: getSession(id) })
})

/* ---- approvals --------------------------------------------------------- */

app.get('/api/approvals', (c) => c.json({ pending: pendingApprovals() }))

app.post('/api/approvals/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = resolveApproval(c.req.param('id'), body.approved === true)
  return c.json({ ok, resolved: ok })
})

/* ---- files (for @mentions in the composer) ------------------------------ */

/* The composer completes "@fi…" against the real tree. A small sync walk of
   its own — workspace-only, node_modules and dot dirs skipped, capped hard. */
function walkSync(root: string, limit: number): string[] {
  const out: string[] = []
  const queue = [root]
  const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-agent', 'app', 'build', '.next', '.cache', '.vite', '__pycache__', '.venv', 'target'])
  while (queue.length && out.length < limit) {
    const dir = queue.shift()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (out.length >= limit) break
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue
        queue.push(full)
      } else if (e.isFile()) {
        out.push(full)
      }
    }
  }
  return out
}

app.get('/api/files', (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase()
  const root = getWorkspace()
  const { files } = { files: walkSync(root, 3_000) }
  const hits = files
    .map((f) => relative(root, f).replace(/\\/g, '/'))
    .filter((rel) => !q || rel.toLowerCase().includes(q))
    .sort((a, b) => a.length - b.length)
    .slice(0, 30)
  return c.json({ files: hits })
})

/* ---- screenshots ------------------------------------------------------- */

/* The browser tool saves PNGs to the OS temp dir; the interface renders them
   like any other image in the thread. The name is the agent's own generated
   file name, sanitised hard — this endpoint serves nothing else. */
app.get('/api/shots/:name', async (c) => {
  const name = c.req.param('name')
  if (!/^shot-\d+\.png$/.test(name)) {
    return c.json({ error: 'no such screenshot' }, 404)
  }
  const file = join(shotsDir(), name)
  if (!existsSync(file)) return c.json({ error: 'no such screenshot' }, 404)
  const data = readFileSync(file)
  return c.body(data, 200, {
    'content-type': 'image/png',
    'cache-control': 'private, max-age=3600',
  })
})

/* ---- checkpoints: undoing a run ----------------------------------------- */

/* The write journal gives every run a rewind button. The UI asks what can be
   undone, and sends a run id (or nothing, meaning the last one) to put the
   files back exactly as they were. */
app.get('/api/checkpoints', (c) => c.json({ checkpoints: listCheckpoints() }))

app.post('/api/checkpoints/rewind', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { runId?: string }
  const target = body.runId ? runStore.get(String(body.runId)) : null
  if (target && (!target.settled || target.workspace !== getWorkspace())) {
    return c.json({ error: 'Stop this run and open its project before undoing its changes.' }, 409)
  }
  const result = body.runId ? rewindRun(String(body.runId)) : rewindLastRun()
  if (!result) {
    return c.json({ error: 'Nothing to rewind — no run has changed any file yet.' }, 404)
  }
  if (target) runStore.annotate(target.id, { type: 'CUSTOM', name: 'loong.rewound', value: { runId: target.id, restored: result.restored.length, removed: result.removed.length, conflicts: result.conflicts, failed: result.failed } } as unknown as BaseEvent)
  return c.json({
    ok: result.failed.length === 0 && result.conflicts.length === 0,
    runId: result.runId,
    restored: result.restored.length,
    removed: result.removed.length, conflicts: result.conflicts, failed: result.failed,
  })
})

/* ---- traces: the run, measured ----------------------------------------- */

/* What Langfuse would show, kept locally: every run with its steps, tool spans,
   tokens and outcome. The numbers come from the events the interface already
   receives — nothing here is estimated. */
app.get('/api/traces', (c) => c.json({ traces: listTraces(50), stats: traceStats(100) }))

app.get('/api/traces/:runId', (c) => {
  const trace = traceFor(c.req.param('runId'))
  return trace ? c.json(trace) : c.json({ error: 'No trace for that run.' }, 404)
})

/* ---- review: the repository as it is (read-only) ------------------------ */

const runGit = promisify(execFile)

async function gitRead(args: string[]): Promise<string> {
  const { stdout } = await runGit('git', args, {
    cwd: getWorkspace(),
    timeout: 8_000,
    maxBuffer: 2_000_000,
    windowsHide: true,
  })
  return stdout
}

export function filesFromNumstat(text: string): { path: string; added: number; removed: number }[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const added = parts[0] === '-' ? 0 : Number(parts[0]) || 0
      const removed = parts[1] === '-' ? 0 : Number(parts[1]) || 0
      const path = parts.slice(2).join('\t')
      return { path, added, removed }
    })
    .filter((f) => f.path)
}

async function countLines(rel: string): Promise<number> {
  try {
    const text = readFileSync(join(getWorkspace(), rel), 'utf8')
    if (text.includes('\u0000')) return 0
    return text.split('\n').length
  } catch {
    return 0
  }
}

app.get('/api/git/status', async (c) => {
  try {
    return c.json({ ok: true, status: await gitRead(['status', '--porcelain=v1', '-b']) })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 200)
  }
})

app.get('/api/git/diff', async (c) => {
  try {
    /* vs HEAD so staged + unstaged show, without `git add -N` mutating the index. */
    const stat = await gitRead(['diff', 'HEAD', '--stat']).catch(() => gitRead(['diff', '--stat']))
    const diff = await gitRead(['diff', 'HEAD']).catch(() => gitRead(['diff']))
    const numstat = await gitRead(['diff', 'HEAD', '--numstat']).catch(() =>
      gitRead(['diff', '--numstat']),
    )
    const files = filesFromNumstat(numstat)
    const seen = new Set(files.map((f) => f.path))
    const others = await gitRead(['ls-files', '--others', '--exclude-standard']).catch(() => '')
    for (const path of others.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (seen.has(path)) continue
      files.push({ path, added: await countLines(path), removed: 0 })
    }
    return c.json({ ok: true, stat, diff: diff.slice(0, 200_000), files })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 200)
  }
})

app.get('/api/git/log', async (c) => {
  try {
    return c.json({ ok: true, log: await gitRead(['log', '--oneline', '-20']) })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 200)
  }
})

/* ---- memory: what the agent kept between sessions ----------------------- */

app.get('/api/memory', (c) => c.json({ entries: listMemory() }))

app.delete('/api/memory/:id', (c) =>
  forget(c.req.param('id'))
    ? c.json({ ok: true })
    : c.json({ error: 'No memory entry with that id.' }, 404),
)

/* ---- the person, and what earlier sessions concluded --------------------
   Both stores are the agent's, but showing them is the user's right: what the
   app believes about them is not a secret it keeps from them. */

app.get('/api/profile', (c) => c.json(readProfile()))

app.post('/api/profile', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; forget?: unknown }
  if (typeof body.name === 'string') setProfileName(body.name)
  if (typeof body.forget === 'string' && body.forget.trim()) {
    if (!forgetProfileFact(body.forget.trim())) {
      return c.json({ error: 'No profile fact with that id.' }, 404)
    }
  }
  return c.json(readProfile())
})

app.get('/api/digests', (c) => {
  const asked = Number(c.req.query('limit'))
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(150, Math.floor(asked)) : 50
  return c.json({ digests: listDigests(limit) })
})

/* ---- the other sessions, as peers ---------------------------------------
   The bus is durable, but this is the read side the interface can poll: who is
   running beside this conversation, and what did they say that is still unread. */

app.get('/api/agents', (c) => {
  const sessionId = c.req.query('session')?.trim()
  if (!sessionId) return c.json({ error: 'session is required' }, 400)
  return c.json({
    peers: peersFor(sessionId),
    peersText: formatPeers(sessionId),
    unread: unreadCount(sessionId),
    inbox: readInbox(sessionId, { mark: c.req.query('mark') === '1', limit: 20 }),
  })
})

/* ---- managed dev servers ------------------------------------------------
   The interface can show what is still holding a port, and stop it without
   spending a model turn on it. */

app.get('/api/servers', (c) => c.json({ servers: listServers() }))

app.post('/api/servers/:id/stop', async (c) => {
  const result = await stopServer(c.req.param('id'))
  return c.json(result, result.ok ? 200 : 404)
})

/* ---- MCP: the servers the user connected -------------------------------- */

app.get('/api/mcp', async (c) => c.json({ servers: await mcpStatus() }))

app.get('/api/mcp/config', (c) => c.json(maskMcpConfig(loadMcpConfig())))

app.put('/api/mcp', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    mcpServers?: Record<string, McpServerSpec>
  }
  /* unmask before validating: the checks have to see the values that will
     actually be spawned with, not the placeholders the UI echoed back */
  const next = unmaskMcpConfig({ mcpServers: body.mcpServers ?? {} }, loadMcpConfig())
  try {
    assertSafeMcpConfig(next)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }
  await disconnectAll()
  saveMcpConfig(next)
  return c.json({ servers: await mcpStatus() })
})

app.post('/api/mcp/:name/test', async (c) => {
  try {
    return c.json(await testMcpServer(c.req.param('name')))
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404)
  }
})

app.delete('/api/mcp/:name', (c) =>
  removeMcpServer(c.req.param('name'))
    ? c.json({ ok: true })
    : c.json({ error: 'No MCP server with that name.' }, 404),
)

/* ---- hooks: the workspace's own code, which needs an explicit yes --------- */

app.get('/api/hooks', (c) => c.json({ pending: pendingHooks() }))

app.post('/api/hooks/trust', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { fingerprint?: string }
  const pending = pendingHooks()
  if (!pending) return c.json({ ok: true, pending: null })
  /* the client sends back the fingerprint it showed the user. If the file
     changed in between, this is not the set of commands they approved. */
  if (body.fingerprint && body.fingerprint !== pending.fingerprint) {
    return c.json(
      { error: 'The hooks file changed since it was shown. Review it again.', pending: pendingHooks() },
      409,
    )
  }
  trustHooks(pending.fingerprint)
  return c.json({ ok: true, pending: pendingHooks() })
})

app.delete('/api/hooks/trust', (c) => {
  untrustHooks()
  return c.json({ ok: true, pending: pendingHooks() })
})

/* ---- the run ----------------------------------------------------------- */

interface RunBody {
  threadId?: string
  requestId?: string
  sessionId?: string
  messages?: ChatMessage[]
  /** the conversation with tool calls and results, preferred over `messages` */
  history?: HistoryTurn[]
  config?: ProviderConfig
  mode?: string
  trust?: string
  /** model routing: 'auto' lets the run fall back across the model chain on a
      fault; 'manual' pins the chosen model and never escalates */
  route?: 'auto' | 'manual'
  /** confidence gate for full-trust writes — see server/confidence.ts */
  confidence?: { threshold?: number; decisionModel?: string }
  /** what the reader wants to be called, from onboarding */
  userName?: string
  /** the optional capabilities the reader turned on */
  capabilities?: Partial<Capabilities>
}

const activeRuns = new Map<string, AbortController>()

async function beginRun(body: RunBody): Promise<{ run: RunRecord } | { error: string; status: 400 | 409 }> {
  const mode: AgentMode = body.mode === 'plan' || body.mode === 'ask' ? body.mode : 'agent'
  const config: ProviderConfig = body.config ?? { provider: 'ollama', model: '' }
  const messages = (Array.isArray(body.messages) ? body.messages : []).filter(
    (m) => m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
  if (!messages.length) return { error: 'No messages to send.', status: 400 }
  if (!config.model?.trim()) return { error: 'Choose a model in the model picker.', status: 400 }
  if (!['ollama', 'openrouter', 'openai', 'anthropic', 'google', 'custom'].includes(config.provider)) {
    return { error: 'Unknown provider.', status: 400 }
  }
  const savedSession = body.sessionId ? getSession(body.sessionId) : null
  if (body.sessionId && !savedSession) return { error: 'This session no longer exists.', status: 400 }
  const runRoot = savedSession?.workspace ?? (haveWorkspace() ? getWorkspace() : mode === 'ask' ? getWorkspace() : null)
  if (!runRoot || !existsSync(runRoot)) return { error: 'Choose a folder first. Select an existing project directory.', status: 400 }
  const threadId = body.threadId ?? body.sessionId ?? randomUUID()
  const previous = runStore.list(threadId)
  if (body.requestId) {
    const existing = previous.find((run) => run.requestId === body.requestId)
    if (existing) return { run: existing }
  }
  if (previous.some((run) => !run.settled)) return { error: 'This task already has a running agent. Reconnect or stop it first.', status: 409 }
  const trust = body.trust === 'auto' ? 'auto' : 'ask'
  const record = runStore.create({ threadId, sessionId: body.sessionId, workspace: runRoot,
    provider: config.provider, selectedModel: config.model, mode, trust,
    route: body.route === 'auto' ? 'auto' : 'manual',
    requestId: typeof body.requestId === 'string' ? body.requestId.slice(0, 100) : undefined })
  const controller = new AbortController()
  activeRuns.set(record.id, controller)
  liveThreads.add(threadId)
  if (body.capabilities && typeof body.capabilities === 'object') setCapabilities(body.capabilities)
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  if (body.sessionId && lastUser) {
    appendMessage({ sessionId: body.sessionId, role: 'user', content: lastUser.content })
    autoTitle(body.sessionId, lastUser.content)
  }
  const previousHistory = previous[0] ? runStore.history(previous[0].id) : null
  const history = previousHistory?.length && lastUser
    ? [...previousHistory, { role: 'user' as const, content: lastUser.content }]
    : Array.isArray(body.history) ? body.history.slice(-400) : undefined
  runStore.checkpoint(record.id, history ?? messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })))
  let assistantText = ''
  const emit = (event: BaseEvent) => {
    if (event.type === 'TEXT_MESSAGE_CONTENT') assistantText += (event as unknown as { delta?: string }).delta ?? ''
    runStore.append(record.id, event)
  }
  // Persist acceptance before launching work. This task outlives its stream subscribers.
  runStore.append(record.id, { type: 'CUSTOM', name: 'loong.run', value: { ...record, task: lastUser?.content } } as unknown as BaseEvent)
  void withRunWorkspace(runRoot, () => runWithRunId(record.id, () => sessionWithId(body.sessionId ?? threadId, () =>
    runAgent({ runId: record.id, threadId, sessionId: body.sessionId, messages, history, config, mode, trust,
      route: record.route, securityScan: true,
      confidence: trust === 'auto' && typeof body.confidence?.threshold === 'number'
        ? { threshold: Math.max(0, Math.min(1, body.confidence.threshold)), decisionModel: body.confidence.decisionModel } : undefined,
      userName: typeof body.userName === 'string' ? body.userName.slice(0, 40) : undefined,
      onCheckpoint: (turns) => runStore.checkpoint(record.id, turns), emit, abortSignal: controller.signal,
    })))).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'The agent failed unexpectedly.'
      emit({ type: 'RUN_ERROR', message } as unknown as BaseEvent)
    }).finally(() => {
      if (body.sessionId && assistantText.trim()) appendMessage({ sessionId: body.sessionId, role: 'assistant', content: assistantText })
      activeRuns.delete(record.id)
      liveThreads.delete(threadId)
      runStore.settle(record.id, controller.signal.aborted ? 'cancelled' : 'partial')
    })
  return { run: record }
}

function eventsResponse(c: Parameters<typeof streamSSE>[0], run: RunRecord, after: number) {
  return streamSSE(c, async (stream) => {
    const encoder = new EventEncoder({ accept: 'text/event-stream' })
    let cursor = after
    let connected = true
    let wake: (() => void) | undefined
    stream.onAbort(() => { connected = false; wake?.() })
    const detach = runStore.subscribe(run.id, () => wake?.())
    try {
      while (connected) {
        const events = runStore.events(run.id, cursor)
        for (const event of events) {
          await stream.write(`id: ${event.sequence}\n` + encoder.encodeSSE(event))
          cursor = event.sequence
        }
        const current = runStore.get(run.id)
        if (current?.settled) {
          // Recovered runs may have no terminal event in their old log.
          await stream.write(`data: ${JSON.stringify({ type: 'CUSTOM', name: 'loong.settled', runId: run.id, value: current })}\n\n`)
          break
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10_000)
          wake = () => { clearTimeout(timer); resolve() }
        })
        wake = undefined
        if (connected) await stream.write(': keep-alive\n\n')
      }
    } catch {
      // Disconnecting a subscriber does not cancel, retry, or finish its task.
    } finally { detach() }
  })
}

app.get('/api/runs', (c) => c.json({ runs: runStore.list(c.req.query('threadId')) }))
app.get('/api/runs/:id', (c) => {
  const run = runStore.get(c.req.param('id'))
  return run ? c.json({ run, events: runStore.events(run.id) }) : c.json({ error: 'Run not found.' }, 404)
})
app.get('/api/runs/:id/events', (c) => {
  const run = runStore.get(c.req.param('id'))
  if (!run) return c.json({ error: 'Run not found.' }, 404)
  const after = Math.max(0, Number(c.req.query('after') ?? c.req.header('last-event-id') ?? 0) || 0)
  return eventsResponse(c, run, after)
})
app.post('/api/runs/:id/cancel', (c) => {
  const id = c.req.param('id')
  const run = runStore.get(id)
  if (!run) return c.json({ error: 'Run not found.' }, 404)
  const controller = activeRuns.get(id)
  if (controller) {
    controller.abort()
    cancelRunApprovals(id)
    cancelRunQuestions(id)
    void killShell(id)
    void stopProject(id)
  }
  return c.json({ ok: true, run: runStore.get(id) })
})
app.post('/api/runs/start', async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: 'Too many runs. Wait a few seconds.' }, 429)
  const result = await beginRun(await c.req.json().catch(() => ({})) as RunBody)
  return 'error' in result ? c.json({ error: result.error }, result.status) : c.json(result, 202)
})
// Backwards-compatible CLI/client route, now backed by the same durable run.
app.post('/api/agent', async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: 'Too many runs. Wait a few seconds.' }, 429)
  const result = await beginRun(await c.req.json().catch(() => ({})) as RunBody)
  return 'error' in result ? c.json({ error: result.error }, result.status) : eventsResponse(c, result.run, 0)
})

app.notFound((c) => c.json({ error: 'not found', path: c.req.path }, 404))

app.onError((err, c) => {
  console.error('[loong] unhandled:', err)
  return c.json({ error: (err as Error).message }, 500)
})

export { app }
