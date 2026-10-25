import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/* ---------------------------------------------------------------------------
   Provider API keys, kept by the agent.

   The rule from the old handshake still holds: a key lives in this process and
   nowhere else. The renderer may SET a key and may ask WHETHER one is set; it
   may never read one back. So GET returns a masked shape — `sk-…4f2a` — which
   is enough to recognise your own key and useless to anyone who steals it.

   The file is written next to the sessions store, in the same data dir, and a
   corrupt file is replaced rather than thrown.
   --------------------------------------------------------------------------- */

const PATH = join(DATA_DIR, 'keys.json')

export const KEY_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google', 'custom'] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]

let keys: Record<string, string> = {}
/* a custom provider is a key AND an endpoint; the endpoint is not a secret, but
   it lives with the key because they are set in the same breath */
let baseUrls: Record<string, string> = {}

export function loadKeys(): void {
  try {
    if (!existsSync(PATH)) return
    const parsed = JSON.parse(readFileSync(PATH, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object') {
      keys = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) keys[k] = v.trim()
      }
      const urls = (parsed as { baseUrls?: unknown }).baseUrls
      if (urls && typeof urls === 'object') {
        for (const [p, v] of Object.entries(urls as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) baseUrls[p] = v.trim()
        }
      }
    }
  } catch {
    keys = {}
  }
}

function flush(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    /* 0600: owner read and write only. This is NOT encryption — an audit is
       right to call that out — but it is the difference between a secret that
       another local account can read and one it cannot, and it costs nothing. */
    writeFileSync(PATH, JSON.stringify({ ...keys, baseUrls }), { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(PATH, 0o600)
    } catch {
      /* Windows ignores POSIX modes; the ACL already limits it to the user */
    }
  } catch {
    /* a read-only data dir must not take the agent down */
  }
}

/** the key for a provider, for the agent's own use — never for the renderer */
export function keyFor(provider: string): string | undefined {
  return keys[provider]
}

/** the last four characters, so the reader can recognise their own key */
function mask(k: string): string {
  const tail = k.slice(-4)
  const head = k.length > 8 ? k.slice(0, 3) : ''
  return `${head ? `${head}…` : ''}${tail}`
}

/** what the interface is allowed to know: which providers have a key, masked */
export function keyStatus(): Record<string, { set: boolean; hint: string; baseUrl: string }> {
  const out: Record<string, { set: boolean; hint: string; baseUrl: string }> = {}
  for (const p of KEY_PROVIDERS) {
    const k = keys[p]
    out[p] = { set: Boolean(k), hint: k ? mask(k) : '', baseUrl: baseUrls[p] ?? '' }
  }
  return out
}

/** the endpoint a custom provider should talk to */
export function baseUrlFor(provider: string): string | undefined {
  const url = baseUrls[provider]
  return url && url.trim() ? url.trim() : undefined
}

export function setBaseUrl(provider: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed) baseUrls[provider] = trimmed
  else delete baseUrls[provider]
  flush()
}

/** set or clear one provider's key; an empty string clears it */
export function setKey(provider: string, value: string): void {
  const trimmed = value.trim()
  if (trimmed) keys[provider] = trimmed
  else delete keys[provider]
  flush()
}
