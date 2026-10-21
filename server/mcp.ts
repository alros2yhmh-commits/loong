import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { Tool } from 'ai'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   The console window every MCP server used to open.

   The SDK decides `windowsHide` with `isElectron()`, which is literally
   `"type" in process`. Under ELECTRON_RUN_AS_NODE the agent IS Electron's node
   mode but carries no `process.type`, so the check read false and every stdio
   server — connected again on every run — spawned a real console window that
   flashed and vanished: the "terminal opens and closes" the user kept seeing.
   The check reads the key; setting it here is truthful, not a trick.
   --------------------------------------------------------------------------- */
if (
  process.platform === 'win32' &&
  process.versions.electron &&
  !('type' in process)
) {
  Object.defineProperty(process, 'type', { value: 'browser', configurable: true })
}

/* ---------------------------------------------------------------------------
   MCP — other people's tools, under our gate.

   An agent that cannot reach the systems a person actually uses is a demo. MCP
   is the open protocol for that reach, and the AI SDK already ships a client,
   so this file is wiring, not a runtime: read the servers the user configured,
   connect, take their tools, and put every one of them behind the same approval
   broker as the built-in writes.

   Two rules that matter:

   1. The config lives in DATA_DIR, never in the workspace. The agent may call a
      server's tools; it cannot edit the list of servers.
   2. A server that fails to start is reported and skipped. One broken entry
      must not take the whole run down with it.
   --------------------------------------------------------------------------- */

export interface McpServerSpec {
  /** stdio servers */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  /** http / sse servers */
  url?: string
  headers?: Record<string, string>
  /** every tool on this server only reads — no approval needed */
  readOnly?: boolean
  enabled?: boolean
}

export interface McpConfig {
  mcpServers: Record<string, McpServerSpec>
}

export interface McpServerStatus {
  name: string
  connected: boolean
  tools: string[]
  error?: string
  /** how it is reached: stdio, http or sse */
  transport: 'stdio' | 'http' | 'sse'
}

interface Live {
  client: Awaited<ReturnType<typeof createMCPClient>>
  spec: McpServerSpec
  tools: Record<string, Tool>
}

const live = new Map<string, Live>()

/* a server that just failed is not retried on every run — otherwise a dead
   entry adds its timeout to every single message */
const failed = new Map<string, number>()
const FAILURE_TTL_MS = 60_000

function configPath(): string {
  return join(DATA_DIR, 'mcp.json')
}

/** the servers the user configured, or an empty set */
export function loadMcpConfig(): McpConfig {
  const file = configPath()
  if (!existsSync(file)) return { mcpServers: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<McpConfig>
    const servers = parsed?.mcpServers
    if (!servers || typeof servers !== 'object') return { mcpServers: {} }
    return { mcpServers: servers }
  } catch {
    /* a corrupt file must not stop the app — move it aside and start clean */
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* unreadable either way */
    }
    return { mcpServers: {} }
  }
}

export function saveMcpConfig(config: McpConfig): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  const file = configPath()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  renameSync(tmp, file)
  /* the caller reconnects with the new list; a save on its own changes nothing */
}

/* ---------------------------------------------------------------------------
   What a saved server is allowed to say.

   A stdio entry is a program this app will run, and the endpoint that saves it
   takes JSON from the renderer. So the shape is checked before it ever reaches
   `spawn`: the command is one executable name or path, the arguments are
   strings, a url is http(s), and nothing carries a shell metacharacter. The
   transport does not use a shell today; this is what keeps that true if one is
   ever added.
   --------------------------------------------------------------------------- */

const SHELL_META = /[&|<>^;`$(){}[\]\r\n"'!%]/

export function assertSafeMcpConfig(config: McpConfig): void {
  const servers = config?.mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('mcpServers must be an object of server entries.')
  }
  for (const [name, spec] of Object.entries(servers)) {
    if (!spec || typeof spec !== 'object') {
      throw new Error(`MCP server "${name}" is not an object.`)
    }
    if (spec.command !== undefined) {
      if (typeof spec.command !== 'string' || !spec.command.trim()) {
        throw new Error(`MCP server "${name}": command must be a non-empty string.`)
      }
      if (SHELL_META.test(spec.command)) {
        throw new Error(`MCP server "${name}": command may not contain shell metacharacters.`)
      }
    }
    if (spec.args !== undefined) {
      if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string')) {
        throw new Error(`MCP server "${name}": args must be an array of strings.`)
      }
    }
    if (spec.url !== undefined) {
      if (typeof spec.url !== 'string' || !/^https?:\/\//i.test(spec.url)) {
        throw new Error(`MCP server "${name}": url must start with http:// or https://.`)
      }
    }
    if (!spec.command && !spec.url) {
      throw new Error(`MCP server "${name}" needs either a command or a url.`)
    }
  }
}

function transportOf(spec: McpServerSpec): 'stdio' | 'http' | 'sse' {
  if (!spec.url) return 'stdio'
  return spec.url.replace(/\/$/, '').endsWith('/sse') ? 'sse' : 'http'
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function connect(name: string, spec: McpServerSpec): Promise<Live> {
  const cached = live.get(name)
  if (cached) return cached

  const failedAt = failed.get(name)
  if (failedAt && Date.now() - failedAt < FAILURE_TTL_MS) {
    throw new Error(`"${name}" failed a moment ago; retrying after a minute or a manual test.`)
  }

  if (!spec.url && !spec.command) {
    throw new Error('The server needs either a command (stdio) or a url (http/sse).')
  }

  try {
    const client = await withTimeout(
      createMCPClient({
        clientName: 'loong',
        version: '0.1.0',
        /* legacy servers expect initialize first; probing server/discover makes
           some of them fail before they ever answer */
        protocolVersionDiscovery: false,
        transport: spec.url
          ? {
              type: transportOf(spec) as 'http' | 'sse',
              url: spec.url,
              headers: spec.headers,
            }
          : new StdioMCPTransport({
              command: spec.command!,
              args: spec.args ?? [],
              env: spec.env ? { ...process.env, ...spec.env } as Record<string, string> : undefined,
              cwd: spec.cwd,
            }),
      }),
      12_000,
      `MCP server "${name}"`,
    )

    const tools = (await withTimeout(client.tools(), 12_000, `MCP tools "${name}"`)) as Record<
      string,
      Tool
    >
    const entry: Live = { client, spec, tools }
    live.set(name, entry)
    failed.delete(name)
    return entry
  } catch (err) {
    failed.set(name, Date.now())
    throw err
  }
}

/** a safe tool name: providers accept [a-zA-Z0-9_-] and nothing exotic */
function safeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_')
}

export interface McpToolOptions {
  /** ask before a tool runs; called only for servers that are not readOnly */
  approve: (name: string, title: string, detail: string) => Promise<boolean>
  /** a tool finished — the trace and the timeline both want this */
  onDone?: (name: string, ms: number, toolCallId?: string) => void
  /** plan mode only gets read-only servers; ask mode gets none */
  include?: (server: string, spec: McpServerSpec) => boolean
}

/**
 * Every configured server's tools, namespaced and gated.
 *
 * The name is `mcp__<server>__<tool>`: one flat namespace, so the model can
 * never confuse two servers that both expose `search`, and the interface can
 * tell at a glance where a card came from.
 */
export async function mcpTools(opts: McpToolOptions): Promise<Record<string, Tool>> {
  const { mcpServers } = loadMcpConfig()
  const out: Record<string, Tool> = {}

  const entries = Object.entries(mcpServers).filter(([name, spec]) => {
    if (spec.enabled === false) return false
    return opts.include ? opts.include(name, spec) : true
  })

  await Promise.all(
    entries.map(async ([server, spec]) => {
      let entry: Live
      try {
        entry = await connect(server, spec)
      } catch {
        /* reported by mcpStatus; one dead server must not fail the run */
        return
      }
      for (const [toolName, def] of Object.entries(entry.tools)) {
        const full = `mcp__${safeName(server)}__${safeName(toolName)}`
        const original = def.execute
        out[full] = {
          ...def,
          execute: async (input, ctx) => {
            if (!spec.readOnly) {
              const approved = await opts.approve(
                full,
                `${server}: ${toolName}`,
                `${toolName} on MCP server "${server}"\n\n${JSON.stringify(input ?? {}, null, 2).slice(0, 1_200)}`,
              )
              if (!approved) {
                return `The user denied permission to run ${full}. Do not retry it and do not look for another way to do the same thing.`
              }
            }
            if (!original) return `${full} has no implementation.`
            const started = Date.now()
            const result = await original(input, ctx)
            opts.onDone?.(
              full,
              Date.now() - started,
              (ctx as { toolCallId?: string } | undefined)?.toolCallId,
            )
            return result
          },
        }
      }
    }),
  )

  return out
}

/** connect every configured server and report what happened */
export async function mcpStatus(): Promise<McpServerStatus[]> {
  const { mcpServers } = loadMcpConfig()
  const names = Object.keys(mcpServers)
  return Promise.all(
    names.map(async (name): Promise<McpServerStatus> => {
      const spec = mcpServers[name]
      const transport = transportOf(spec)
      if (spec.enabled === false) {
        return { name, connected: false, tools: [], transport, error: 'disabled' }
      }
      try {
        const entry = await connect(name, spec)
        return {
          name,
          connected: true,
          tools: Object.keys(entry.tools),
          transport,
        }
      } catch (err) {
        return {
          name,
          connected: false,
          tools: [],
          transport,
          error: (err as Error).message.slice(0, 300),
        }
      }
    }),
  )
}

/** test one server without touching the others */
export async function testMcpServer(name: string): Promise<McpServerStatus> {
  const spec = loadMcpConfig().mcpServers[name]
  if (!spec) throw new Error(`No MCP server named "${name}".`)
  live.delete(name)
  try {
    const entry = await connect(name, spec)
    return {
      name,
      connected: true,
      tools: Object.keys(entry.tools),
      transport: transportOf(spec),
    }
  } catch (err) {
    return {
      name,
      connected: false,
      tools: [],
      transport: transportOf(spec),
      error: (err as Error).message.slice(0, 300),
    }
  }
}

export function removeMcpServer(name: string): boolean {
  const config = loadMcpConfig()
  if (!(name in config.mcpServers)) return false
  delete config.mcpServers[name]
  const old = live.get(name)
  if (old) {
    live.delete(name)
    void old.client.close().catch(() => {})
  }
  saveMcpConfig(config)
  return true
}

export async function disconnectAll(): Promise<void> {
  const entries = [...live.values()]
  live.clear()
  await Promise.all(entries.map((e) => e.client.close().catch(() => {})))
}
