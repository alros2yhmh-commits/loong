import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

/* ---------------------------------------------------------------------------
   Settings.

   The provider block is the only part of this that is not cosmetic, so it is
   the only part that gets its own section at the top. What is NOT here any
   more: the API key. It lives in the OS keychain (see lib/keys.ts) and the
   renderer cannot read it back — this comment is the proof it moved.
   --------------------------------------------------------------------------- */

export type ProviderId =
  | 'ollama'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'custom'

export interface ProviderSpec {
  id: ProviderId
  label: string
  /** needs a key to talk to it at all */
  keyed: boolean
  /** fixed endpoint, or null when the user supplies one */
  endpoint: string | null
  /** shown as datalist suggestions, not enforced — any id the provider accepts will do */
  suggestions: string[]
  blurb: string
}

/** mirrors server/providers.ts — the ids must match or the run is refused */
export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    keyed: false,
    endpoint: 'http://127.0.0.1:11434/v1',
    suggestions: [],
    blurb: 'Models already on this machine. No key, no network, works offline.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyed: true,
    endpoint: 'https://openrouter.ai/api/v1',
    /* replaced at runtime by the live catalogue; this is only what is shown
       before that request lands */
    suggestions: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'cohere/north-mini-code:free',
      'google/gemma-4-31b-it:free',
    ],
    blurb:
      'One key, many models. The free tier is shared and rate-limits under load, so Loong retries before giving up.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyed: true,
    endpoint: 'https://api.anthropic.com',
    suggestions: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    blurb: 'Direct to the API. The key is held by the local agent process, not the browser.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyed: true,
    endpoint: 'https://api.openai.com/v1',
    suggestions: ['gpt-5', 'gpt-5-mini', 'o4-mini'],
    blurb: 'Direct to the API. The key is held by the local agent process, not the browser.',
  },
  {
    id: 'google',
    label: 'Google',
    keyed: true,
    endpoint: 'https://generativelanguage.googleapis.com',
    suggestions: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    blurb:
      'Direct to the API. Avoid the "Flash Lite" models for agent work — their output budget is tiny and the run stops mid-task. Use Pro or Flash.',
  },
  {
    id: 'custom',
    label: 'Custom',
    keyed: true,
    endpoint: null,
    suggestions: [],
    blurb: 'Any OpenAI-compatible endpoint. Give it a base URL.',
  },
]

/** a saved command — a reusable prompt the reader invokes with `/name args` */
export interface SavedCommand {
  id: string
  /** the slash name, without the leading slash */
  name: string
  /** the prompt template; $ARGUMENTS is replaced with what follows the name */
  prompt: string
  hint?: string
}

/** a small, honest starter set — copy, edit, delete; these are prompts, not code */
export const STARTER_COMMANDS: SavedCommand[] = [
  {
    id: 'builtin-review',
    name: 'review',
    prompt:
      'Review the current work for correctness, security and edge cases. Read the diff, then list every problem ranked by severity with file:line. Do not fix anything yet.',
    hint: 'ranked problems, no fixes',
  },
  {
    id: 'builtin-test',
    name: 'test',
    prompt:
      'Write tests for the change you just made. Cover the happy path, boundaries and the failure cases, then run them and report the result.',
    hint: 'happy path + edges + failures',
  },
  {
    id: 'builtin-explain',
    name: 'explain',
    prompt:
      'Explain $ARGUMENTS in plain language: what it does, why it is built this way, and any risks. Make no changes.',
    hint: 'plain-language explanation',
  },
  {
    id: 'builtin-optimize',
    name: 'optimize',
    prompt:
      'Find the performance problems in $ARGUMENTS. For each, propose a concrete change with its expected impact. Do not apply anything yet.',
    hint: 'propose, do not apply',
  },
]

export interface Settings {
  provider: ProviderId
  model: string
  baseUrl: string
  soundEnabled: boolean
  volume: number
  motion: 'system' | 'full' | 'reduced'
  threadFontSize: number
  /** 'ask' stops before every write; 'auto' runs the whole job unattended */
  trust: 'ask' | 'auto'
  /** how the model is picked for each run — the router */
  route: 'manual' | 'auto' | 'fast' | 'deep'
  /** what the reader asked to be called; '' until onboarding */
  userName: string
  /** the welcome screen has been answered — never show it twice */
  onboarded: boolean
  /** saved slash commands — reusable prompts, see SavedCommand */
  commands: SavedCommand[]
  /** below this confidence a gated write in full-trust mode parks for review */
  confidenceThreshold: number
  /** the model that estimates confidence for gated writes; '' reuses the run's */
  decisionModel: string
}

const DEFAULTS: Settings = {
  provider: 'ollama',
  /* qwen3:8b is the model that actually calls tools. qwen3.5:0.8b is faster but
     too weak to invoke anything, and qwen2.5-coder cannot emit tool calls at all.
     A slow agent that works beats a fast one that does nothing. */
  model: 'qwen3:8b',
  baseUrl: '',
  /* the default is the light look: a white canvas with black engraving, the
     one the window is remembered by. Dark is the same ramp read backwards
     and lives one click away in Appearance. */
  soundEnabled: false,
  volume: 0.7,
  motion: 'system',
  threadFontSize: 13.5,
  /* safe by default — the switch is one click away in the composer */
  trust: 'ask',
  /* auto picks per message, with a tool-calling floor — see lib/router.ts */
  route: 'auto',
  userName: '',
  onboarded: false,
  commands: STARTER_COMMANDS,
  /* 0.7: the model's own estimate that "this write is safe to apply". Below it,
     full-trust still parks the change for a human. See server/confidence.ts. */
  confidenceThreshold: 0.7,
  decisionModel: '',
}


/* a one-time migration, keyed on the storage version.
   Settings written by the previous build say "dark" because that was the only
   look there was — it is a default, not a choice. The stamp separates the two:
   a reader who PICKED dark in the new build is never overridden, but a profile
   from before the choice existed starts on the light look. */
const KEY = 'loong.settings'

function load(): Settings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
    return DEFAULTS
  } catch {
    return DEFAULTS
  }
}

interface Ctx {
  settings: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  provider: ProviderSpec
  reset: () => void
}

const SettingsContext = createContext<Ctx | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    window.localStorage.setItem(KEY, JSON.stringify(settings))
  }, [settings])

  const set = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) =>
      setSettings((s) => ({ ...s, [key]: value })),
    [],
  )

  const reset = useCallback(() => setSettings(DEFAULTS), [])

  const value = useMemo<Ctx>(
    () => ({
      settings,
      set,
      reset,
      provider:
        PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0],
    }),
    [settings, set, reset],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings outside SettingsProvider')
  return ctx
}

export const DEFAULT_SETTINGS = DEFAULTS
