import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'

/* The desktop unwraps this key through Electron safeStorage. Remove the bridge
   value before any workspace command inherits process.env. Headless development
   can run without a key, with an explicitly reported plaintext storage mode. */
const suppliedKey = process.env.LOONG_KEY_ENCRYPTION_KEY
delete process.env.LOONG_KEY_ENCRYPTION_KEY
const PATH = join(DATA_DIR, 'keys.json')
const AAD = Buffer.from('Loong provider keys v1')
let encryptionKey: Buffer | undefined
let storageError: string | undefined
if (suppliedKey) {
  const decoded = Buffer.from(suppliedKey, 'base64')
  if (decoded.length === 32 && decoded.toString('base64') === suppliedKey) encryptionKey = decoded
  else storageError = 'The credential encryption key is invalid. Existing credentials were preserved.'
}

export const KEY_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google', 'custom'] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]
let keys: Record<string, string> = {}
let baseUrls: Record<string, string> = {}
let loaded = false

interface Envelope { version: 1; encrypted: true; iv: string; tag: string; data: string }

/** Metadata only: neither the encryption key nor provider values leave here. */
export function keyStorageStatus(): { mode: 'encrypted' | 'plaintext' | 'unavailable'; error?: string } {
  if (!loaded) loadKeys()
  return storageError ? { mode: 'unavailable', error: storageError }
    : { mode: encryptionKey ? 'encrypted' : 'plaintext' }
}

function payloadOf(parsed: unknown): { keys: Record<string, string>; baseUrls: Record<string, string> } {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid credential data')
  const data = parsed as Record<string, unknown>
  const source = data.keys && typeof data.keys === 'object' ? data.keys as Record<string, unknown> : data
  const next: Record<string, string> = {}, urls: Record<string, string> = {}
  for (const provider of KEY_PROVIDERS) {
    if (typeof source[provider] === 'string' && source[provider].trim()) next[provider] = source[provider].trim()
  }
  if (data.baseUrls && typeof data.baseUrls === 'object') {
    for (const provider of KEY_PROVIDERS) {
      const value = (data.baseUrls as Record<string, unknown>)[provider]
      if (typeof value === 'string' && value.trim()) urls[provider] = value.trim()
    }
  }
  return { keys: next, baseUrls: urls }
}

function encryptedPayload(parsed: Envelope): unknown {
  if (!encryptionKey) throw new Error('Missing encryption key')
  const iv = Buffer.from(parsed.iv, 'base64'), tag = Buffer.from(parsed.tag, 'base64')
  if (parsed.version !== 1 || iv.length !== 12 || tag.length !== 16 || typeof parsed.data !== 'string') throw new Error('Invalid envelope')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv)
  decipher.setAAD(AAD)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, 'base64')), decipher.final()]).toString('utf8'))
}

/** Corrupt or locked stores remain untouched, and cannot be silently overwritten. */
export function loadKeys(): void {
  loaded = true
  if (storageError) return
  keys = {}; baseUrls = {}
  try {
    if (!existsSync(PATH)) return
    const content = readFileSync(PATH, 'utf8')
    if (content.length > 1_000_000) throw new Error('Credential store is too large')
    const parsed = JSON.parse(content) as Record<string, unknown>
    const encrypted = parsed?.encrypted === true
    const payload = payloadOf(encrypted ? encryptedPayload(parsed as unknown as Envelope) : parsed)
    keys = payload.keys; baseUrls = payload.baseUrls
    // Replace legacy plaintext only after authenticated encryption and an atomic write succeed.
    if (!encrypted && encryptionKey) persist(keys, baseUrls)
  } catch {
    keys = {}; baseUrls = {}
    storageError = 'The credential store could not be unlocked or read. Existing credentials were preserved; restore the correct OS keyring or a backup before changing them.'
  }
}

function persist(next: Record<string, string>, urls: Record<string, string>): void {
  if (storageError) throw new Error(storageError)
  const payload = JSON.stringify({ keys: next, baseUrls: urls })
  let serialized: string
  if (encryptionKey) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
    cipher.setAAD(AAD)
    const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
    const envelope: Envelope = { version: 1, encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
    serialized = JSON.stringify(envelope)
  } else serialized = JSON.stringify({ ...next, baseUrls: urls })
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const temporary = `${PATH}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, serialized, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor); descriptor = undefined
    renameSync(temporary, PATH)
  } catch {
    throw new Error('The provider credentials could not be saved. Existing credentials were preserved; check the data directory permissions.')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}

function ensureWritable(): void {
  if (!loaded) loadKeys()
  if (storageError) throw new Error(storageError)
}

/** Provider values stay in the agent; the renderer receives status only. */
export function keyFor(provider: string): string | undefined { if (!loaded) loadKeys(); return keys[provider] }
function mask(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length)
  const head = value.length > 8 ? `${value.slice(0, 3)}…` : ''
  return `${head}${value.slice(-4)}`
}
export function keyStatus(): Record<string, { set: boolean; hint: string; baseUrl: string }> {
  if (!loaded) loadKeys()
  const out: Record<string, { set: boolean; hint: string; baseUrl: string }> = {}
  for (const provider of KEY_PROVIDERS) {
    const key = keys[provider]
    out[provider] = { set: Boolean(key), hint: key ? mask(key) : '', baseUrl: baseUrls[provider] ?? '' }
  }
  return out
}
export function baseUrlFor(provider: string): string | undefined { if (!loaded) loadKeys(); return baseUrls[provider]?.trim() || undefined }
export function setBaseUrl(provider: string, value: string): void {
  ensureWritable()
  const next = { ...baseUrls }, trimmed = value.trim()
  if (trimmed) next[provider] = trimmed
  else delete next[provider]
  persist(keys, next)
  baseUrls = next
}
export function setKey(provider: string, value: string): void {
  ensureWritable()
  const next = { ...keys }, trimmed = value.trim()
  if (trimmed) next[provider] = trimmed
  else delete next[provider]
  persist(next, baseUrls)
  keys = next
}
