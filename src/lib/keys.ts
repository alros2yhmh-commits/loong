/* ---------------------------------------------------------------------------
   The API key store.

   The key is NOT in this file's localStorage. In the packaged app the main
   process holds it, encrypted with the OS keychain (DPAPI / Keychain / Secret
   Service via Electron safeStorage), and the agent receives it once at spawn
   over a handshake file it deletes. The renderer can therefore ask only two
   questions: "is a key set?" and "store this one" — it can never read one
   back. An XSS in the interface has nothing to steal.

   In dev (plain browser, no preload) there is no OS keychain to talk to, so
   the key falls back to localStorage and is sent with the run request the way
   it always was. That is a development convenience, not the shipped path.
   --------------------------------------------------------------------------- */

const DEV_KEY = 'loong.devkeys.v1'

interface KeyBridge {
  setKey?: (provider: string, key: string) => Promise<{ ok: boolean }>
  hasKey?: (provider: string) => Promise<boolean>
}

function bridge(): KeyBridge {
  return (
    (window as unknown as { loong?: KeyBridge }).loong ?? {}
  )
}

/** true when the packaged key path is available */
export function secureKeys(): boolean {
  return typeof bridge().setKey === 'function'
}

/**
 * Move a key left over from the old localStorage path into the OS keychain,
 * once, so nobody has to paste a key that was already saved.
 */
async function migrateDevKey(provider: string): Promise<void> {
  if (!secureKeys()) return
  try {
    const raw = window.localStorage.getItem(DEV_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    const old = all[provider]
    if (!old) return
    delete all[provider]
    window.localStorage.setItem(DEV_KEY, JSON.stringify(all))
    await keySet(provider, old)
  } catch {}
}

export async function keyHas(provider: string): Promise<boolean> {
  const b = bridge()
  if (b.hasKey) {
    try {
      const has = await b.hasKey(provider)
      if (has) return true
      await migrateDevKey(provider)
      return await b.hasKey(provider)
    } catch {
      return false
    }
  }
  try {
    const raw = window.localStorage.getItem(DEV_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return Boolean(all[provider])
  } catch {
    return false
  }
}

/** the key to send with a run — only ever non-empty in dev */
export async function keyForRun(provider: string): Promise<string | undefined> {
  if (secureKeys()) return undefined
  try {
    const raw = window.localStorage.getItem(DEV_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return all[provider] || undefined
  } catch {
    return undefined
  }
}

export async function keySet(provider: string, key: string): Promise<boolean> {
  const b = bridge()
  if (b.setKey) {
    try {
      const res = await b.setKey(provider, key)
      announceKeyChange()
      return res?.ok === true
    } catch {
      return false
    }
  }
  try {
    const raw = window.localStorage.getItem(DEV_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    if (key.trim()) all[provider] = key.trim()
    else delete all[provider]
    window.localStorage.setItem(DEV_KEY, JSON.stringify(all))
    announceKeyChange()
    return true
  } catch {
    return false
  }
}

/**
 * Tell the rest of the app a key changed.
 *
 * Without this, a run built before the key was saved carries no key — the
 * interface looks exactly like a provider that "needs an API key" no matter
 * how many times the reader saves one.
 */
function announceKeyChange(): void {
  try {
    window.dispatchEvent(new Event('loong:keys-changed'))
  } catch {}
}
