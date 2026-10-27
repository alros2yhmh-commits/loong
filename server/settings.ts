import { DATA_DIR } from './config.ts'
import { readFileSync, renameSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
   Reader settings, on a JSON file.

   These used to live in the browser's localStorage. That was fine while the
   interface existed; when the interface was rebuilt from scratch, every
   preference went with it and the reader had to re-pick a model on every
   launch. A preference that does not survive a restart is not a preference.

   The store pattern is copied from server/db.ts on purpose: atomic write
   (temp file + rename), a corrupt file moved aside rather than deleted, and a
   read-only data dir that cannot take the agent down.
   --------------------------------------------------------------------------- */

export interface Settings {
  provider: string
  model: string
  /** the route the model picker chooses: auto picks per run, manual is fixed */
  route: 'auto' | 'manual'
  mode: 'ask' | 'plan' | 'agent'
  /** ask = every write asks; auto = full trust, gated by the confidence gate */
  trust: 'ask' | 'auto'
  soundEnabled: boolean
  volume: number
  reducedMotion: boolean
  /** the conversation text size, in px — a reader with poor eyesight needs it */
  fontSize: number
  /** Normal / Thinking / Verbose — the three live view modes */
  view: 'normal' | 'thinking' | 'verbose'
  /** what the reader wants to be called */
  userName: string
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  model: '',
  route: 'manual',
  mode: 'agent',
  trust: 'ask',
  soundEnabled: false,
  volume: 0.4,
  reducedMotion: false,
  fontSize: 14,
  view: 'normal',
  userName: '',
}

/** the permission mode is remembered per folder, except Plan which is per session */
export interface FolderPrefs {
  mode?: 'ask' | 'plan' | 'agent'
  trust?: 'ask' | 'auto'
}

interface SettingsStore {
  settings: Settings
  folders: Record<string, FolderPrefs>
}

const PATH = join(DATA_DIR, 'settings.json')

const EMPTY: SettingsStore = { settings: { ...DEFAULT_SETTINGS }, folders: {} }

function load(): SettingsStore {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const raw = readFileSync(PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SettingsStore>
    if (!parsed || typeof parsed !== 'object') throw new Error('unexpected shape')
    return {
      settings: clean({ ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}), ...(parsed.settings?.mode === 'plan' ? { mode: 'agent' } : {}) }),
      folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      try {
        renameSync(PATH, `${PATH}.corrupt-${Date.now()}`)
      } catch {
        /* the in-memory defaults still serve this session */
      }
    }
    return { ...EMPTY, settings: { ...DEFAULT_SETTINGS } }
  }
}

let store: SettingsStore = load()

function flush(): void {
  /* Plan is a temporary interaction mode, not a restart default. */
  const body = JSON.stringify({
    ...store,
    settings: { ...store.settings, mode: store.settings.mode === 'plan' ? 'agent' : store.settings.mode },
  })
  const tmp = `${PATH}.tmp`
  try {
    writeFileSync(tmp, body, 'utf8')
    try {
      renameSync(tmp, PATH)
    } catch {
      writeFileSync(PATH, body, 'utf8')
      try {
        unlinkSync(tmp)
      } catch {
        /* nothing to clean up */
      }
    }
  } catch {
    /* a read-only data dir must not take the agent down */
  }
}

/* ---- validation ---------------------------------------------------------
   A setting is not trusted because it arrived over HTTP. Every field is
   coerced to its type and clamped to its range, and an unknown value falls
   back to the default rather than being stored. */

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo
}

function clean(input: unknown): Settings {
  const raw = (input ?? {}) as Record<string, unknown>
  const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback
  return {
    provider: pick(raw.provider, ['ollama', 'openrouter', 'anthropic', 'openai', 'google', 'custom'], DEFAULT_SETTINGS.provider),
    model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 256) : DEFAULT_SETTINGS.model,
    route: pick(raw.route, ['auto', 'manual'] as const, DEFAULT_SETTINGS.route),
    mode: pick(raw.mode, ['ask', 'plan', 'agent'] as const, DEFAULT_SETTINGS.mode),
    trust: pick(raw.trust, ['ask', 'auto'] as const, DEFAULT_SETTINGS.trust),
    soundEnabled: typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    volume: typeof raw.volume === 'number' ? clamp(raw.volume, 0, 1) : DEFAULT_SETTINGS.volume,
    reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    fontSize: typeof raw.fontSize === 'number' ? clamp(Math.round(raw.fontSize), 11, 24) : DEFAULT_SETTINGS.fontSize,
    view: pick(raw.view, ['normal', 'thinking', 'verbose'] as const, DEFAULT_SETTINGS.view),
    userName: typeof raw.userName === 'string' ? raw.userName.slice(0, 40) : DEFAULT_SETTINGS.userName,
  }
}

export function getSettings(): Settings {
  return { ...store.settings }
}

/** merge, so a reader can update one field without sending the whole object */
export function putSettings(input: unknown): Settings {
  store.settings = clean({ ...store.settings, ...((input ?? {}) as Record<string, unknown>) })
  flush()
  return getSettings()
}

export function getFolderPrefs(workspace: string | null): FolderPrefs {
  if (!workspace) return {}
  return { ...(store.folders[workspace] ?? {}) }
}

export function putFolderPrefs(workspace: string | null, prefs: FolderPrefs): FolderPrefs {
  if (!workspace) return {}
  /* Plan is session-only by design; it is never remembered per folder */
  const next: FolderPrefs = { ...(store.folders[workspace] ?? {}), ...prefs }
  if (next.mode === 'plan') delete next.mode
  store.folders[workspace] = next
  flush()
  return { ...next }
}
