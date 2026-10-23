/* ---------------------------------------------------------------------------
   Integrations — a gallery, not a JSON form.

   MCP is how an agent reaches the outside world, and the config is a JSON file
   with a command and a few env vars. Asking a reader to write that by hand is
   asking them to read a spec before they can read their email.

   Each preset is a server that actually exists, with the one thing it needs
   spelled out. "Connect" writes the entry into mcp.json; the agent picks it up
   on the next run. Nothing is installed until it is used — npx resolves the
   package at launch, so a preset you never connect costs nothing.
   --------------------------------------------------------------------------- */

import { loadMcpConfig, saveMcpConfig } from './mcp.ts'
import { getWorkspace } from './config.ts'

export interface Integration {
  id: string
  name: string
  /** what the agent can do once it is connected */
  blurb: string
  /** the env var or value the reader has to supply, if any */
  needs?: string
  /** a link to where that value comes from */
  docs?: string
  /** the MCP entry this preset writes */
  server: { command: string; args: string[]; env?: Record<string, string> }
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    blurb: 'Search mail, read threads, draft and send — with your approval before anything leaves.',
    docs: 'https://github.com/GongRzhe/Gmail-MCP-Server',
    server: {
      command: 'npx',
      args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Issues, pull requests, code search and releases — the repo without leaving the thread.',
    needs: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    docs: 'https://github.com/github/github-mcp-server',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    blurb: 'Read and write pages and databases — the notes next to the code.',
    needs: 'NOTION_TOKEN',
    docs: 'https://github.com/makenotion/notion-mcp-server',
    server: {
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: '' },
    },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    blurb: 'Read and write outside the project folder, scoped to the paths you choose.',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    blurb: 'Google publishes its own Workspace servers — Drive, Docs, Sheets, Calendar — behind OAuth.',
    docs: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
    needs: 'Google OAuth setup',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
    },
  },
]

/** which presets are already in the config */
export function configuredIntegrations(): Record<string, boolean> {
  const servers = loadMcpConfig().mcpServers ?? {}
  const out: Record<string, boolean> = {}
  for (const preset of INTEGRATIONS) out[preset.id] = Boolean(servers[preset.id])
  return out
}

/** write a preset into mcp.json — the agent connects on the next run */
export function connectIntegration(id: string, values?: Record<string, string>): {
  ok: boolean
  error?: string
} {
  const preset = INTEGRATIONS.find((i) => i.id === id)
  if (!preset) return { ok: false, error: 'no such integration' }
  const config = loadMcpConfig()
  const env: Record<string, string> = { ...(preset.server.env ?? {}) }
  for (const key of Object.keys(env)) {
    const given = values?.[key]?.trim()
    if (given) env[key] = given
  }
  /* the filesystem server takes the folders it may touch as arguments */
  const args =
    id === 'filesystem' && values?.path?.trim()
      ? [...preset.server.args, values.path.trim()]
      : [...preset.server.args]
  config.mcpServers[id] = {
    command: preset.server.command,
    args,
    ...(Object.keys(env).length ? { env } : {}),
  }
  saveMcpConfig(config)
  return { ok: true }
}

export function disconnectIntegration(id: string): { ok: boolean } {
  const config = loadMcpConfig()
  delete config.mcpServers[id]
  saveMcpConfig(config)
  return { ok: true }
}

/** the folder the filesystem preset is allowed to touch by default */
export function defaultIntegrationPath(): string {
  return getWorkspace()
}
