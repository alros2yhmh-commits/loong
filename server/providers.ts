import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { baseUrlFor, keyFor } from './keys.ts'

/* ---------------------------------------------------------------------------
   Providers.

   One interface, five sources. The AI SDK does the actual work here — this file
   only decides which of its adapters to hand back. Ollama speaks the OpenAI
   wire format, so it needs no special provider package and no API key, which is
   what makes the whole app testable offline.
   --------------------------------------------------------------------------- */

export type ProviderId =
  | 'ollama'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'custom'

export interface ProviderConfig {
  provider: ProviderId
  model: string
  apiKey?: string
  /** only used when provider is 'custom' */
  baseUrl?: string
}

export const OLLAMA_BASE = process.env.LOONG_OLLAMA ?? 'http://127.0.0.1:11434'
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export interface ProviderSpec {
  id: ProviderId
  label: string
  keyed: boolean
  endpoint: string | null
  suggestions: string[]
  blurb: string
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    keyed: false,
    endpoint: `${OLLAMA_BASE}/v1`,
    suggestions: [],
    blurb: 'Models already on this machine. No key, no network, works offline.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyed: true,
    endpoint: `${OPENROUTER_BASE}`,
    /* the live list comes from /api/openrouter/models; these are only the
       fallback shown before that request lands */
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
    blurb: 'Direct to the API. The key is held by the local agent process, not the browser.',
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

/* ---------------------------------------------------------------------------
   The runtime key store.

   The main process encrypts API keys with the OS keychain (Electron
   safeStorage) and hands the plaintext over once, at spawn, in a file this
   process deletes after reading. The renderer never holds a key, so an XSS in
   the interface has nothing to steal.
   --------------------------------------------------------------------------- */

let runtimeKeys: Record<string, string> = {}

/** read the handshake file into memory and destroy it. Safe to call once. */
export function loadRuntimeKeys(): void {
  const file = process.env.LOONG_KEY_FILE
  if (!file || !existsSync(file)) return
  try {
    runtimeKeys = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  } catch {
    runtimeKeys = {}
  }
  try {
    rmSync(file, { force: true })
  } catch {}
}

/** the stored key for a provider — the live store first, then the handshake */
export function storedKey(provider: string): string | undefined {
  const live = keyFor(provider)
  if (live) return live
  const key = runtimeKeys[provider]
  return key && key.trim() ? key.trim() : undefined
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/* ---------------------------------------------------------------------------
   Fallback chains.

   A free model that is saturated is not a broken app, it is a shared resource
   being busy. The retry loop already waits; this gives it somewhere to go on
   the next attempt — a model that can do the same job, not a random swap.

   These ids move with the free tier, which moves weekly. They are a fallback,
   not a promise: the reader can always pick anything in Settings.
   --------------------------------------------------------------------------- */

export const MODEL_FALLBACKS: Record<ProviderId, string[]> = {
  /* free, tool-capable, and answering — checked against the provider, not
     against a blog post. A fallback that is itself 404 is worse than none: the
     run spends its attempts discovering that the whole chain is dead. */
  openrouter: [
    'poolside/laguna-s-2.1:free',
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
  ],
  /* the one local model whose chat template actually emits tool calls */
  ollama: [],
  /* a paid model was chosen on purpose — never silently swap providers */
  anthropic: [],
  openai: [],
  google: [],
  custom: [],
}

/**
 * Call-level provider options: prompt caching where the provider bills for
 * context, and extended thinking where it exists.
 *
 * Best-effort by design — a provider that does not know a key ignores it, and
 * one that does not cache simply costs what it always cost.
 */
export function callProviderOptions(cfg: ProviderConfig): Record<string, unknown> {
  const shared = { cacheControl: { type: 'ephemeral' } }
  switch (cfg.provider) {
    case 'openrouter':
      /* OpenRouter's documented body field; the compatible provider forwards it.
         parallelToolCalls rides the openai-compatible envelope so independent
         reads fire together instead of one-by-one. */
      /* Entries under the provider's own name are spread straight into the
         request body, so this one has to be spelled the way the API spells it:
         parallel_tool_calls. The camelCase form is a typed option of the `openai`
         provider and was ignored here — which is why independent reads went one
         at a time on the default provider. */
      return {
        openrouter: { ...shared, parallel_tool_calls: true },
        openai: { parallelToolCalls: true },
      }
    case 'anthropic':
      return { anthropic: shared }
    case 'google':
      /* thinking makes the model deliberate instead of answering at once */
      return { google: { thinkingConfig: { thinkingBudget: 8_192 } } }
    case 'openai':
      return { openai: { reasoningEffort: 'medium', parallelToolCalls: true } }
    default:
      return {}
  }
}

export function resolveModel(cfg: ProviderConfig): LanguageModel {
  const model = cfg.model?.trim()
  if (!model) throw new ProviderError('No model selected.')
  /* the request may omit the key: the renderer no longer holds one. The stored
     key from the OS keychain is the fallback. */
  const apiKey = cfg.apiKey?.trim() || storedKey(cfg.provider)

  switch (cfg.provider) {
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: `${OLLAMA_BASE}/v1`,
      }).chatModel(model)

    case 'openrouter': {
      if (!apiKey) throw new ProviderError('OpenRouter needs an API key.')
      return createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE,
        apiKey,
        /* OpenRouter attributes traffic from these; without them it still
           works, but the dashboard cannot tell one app from another */
        headers: {
          'HTTP-Referer': 'https://github.com/loong-app',
          'X-Title': 'Loong',
        },
      }).chatModel(model)
    }

    case 'anthropic': {
      if (!apiKey) throw new ProviderError('Anthropic needs an API key.')
      return createAnthropic({ apiKey })(model)
    }

    case 'openai': {
      if (!apiKey) throw new ProviderError('OpenAI needs an API key.')
      return createOpenAI({ apiKey })(model)
    }

    case 'google': {
      if (!apiKey) throw new ProviderError('Google needs an API key.')
      return createGoogleGenerativeAI({ apiKey })(model)
    }

    case 'custom': {
      /* the endpoint may arrive with the run or be stored from Settings */
      const baseUrl = cfg.baseUrl?.trim() || baseUrlFor('custom')
      if (!baseUrl) throw new ProviderError('A custom provider needs a base URL.')
      return createOpenAICompatible({
        name: 'custom',
        baseURL: baseUrl,
        apiKey: apiKey ?? 'not-needed',
      }).chatModel(model)
    }
  }
}

export interface LocalModel {
  name: string
  sizeBytes: number
  family: string
  /** Ollama reports capability tags; tools is the one we care about */
  supportsTools: boolean
}

/** Ask the local Ollama daemon what it actually has installed. */
export async function listLocalModels(): Promise<LocalModel[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new ProviderError(`Ollama answered ${res.status}`)
  const body = (await res.json()) as {
    models?: {
      name: string
      size?: number
      details?: { family?: string; families?: string[] }
    }[]
  }
  return (body.models ?? []).map((m) => ({
    name: m.name,
    sizeBytes: m.size ?? 0,
    family: m.details?.family ?? 'unknown',
    /* the coder models ship a chat template without tool tokens, so they emit
       tool calls as text. Flagged here so the settings screen can warn. */
    supportsTools: !/coder/i.test(m.name),
  }))
}

export async function probeOllama(): Promise<{ up: boolean; version?: string }> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/version`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { up: false }
    const body = (await res.json()) as { version?: string }
    return { up: true, version: body.version }
  } catch {
    return { up: false }
  }
}

/* ---------------------------------------------------------------------------
   OpenRouter's catalogue.

   Fetched live rather than hard-coded, because the free tier changes weekly and
   a baked-in list goes stale silently. The endpoint is public, so no key is
   needed to read it. Only models that actually advertise tool support are
   returned — a model that cannot call a tool cannot drive an agent, and
   offering one would look like a bug in Loong.
   --------------------------------------------------------------------------- */

export interface RemoteModel {
  id: string
  name: string
  contextLength: number
  /** per million tokens, as strings because OpenRouter prices in exact decimals */
  promptPrice: string
  free: boolean
  /** every model that reaches here has already passed the tool-call filter */
  supportsTools: boolean
  /** whether the model accepts image parts — the composer warns before a run */
  vision: boolean
}

interface Cache {
  at: number
  models: RemoteModel[]
}
let catalogueCache: Cache | null = null
const CATALOGUE_TTL = 10 * 60_000

export async function listOpenRouterModels(force = false): Promise<RemoteModel[]> {
  if (!force && catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL) {
    return catalogueCache.models
  }
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new ProviderError(`OpenRouter catalogue answered ${res.status}`)

  const body = (await res.json()) as {
    data?: {
      id: string
      name?: string
      context_length?: number
      pricing?: { prompt?: string }
      supported_parameters?: string[]
      architecture?: { input_modalities?: string[] }
    }[]
  }

  const models: RemoteModel[] = (body.data ?? [])
    .filter((m) => (m.supported_parameters ?? []).includes('tools'))
    /* these can never run through Loong's chat/completions adapter, so hide
       them from the picker instead of letting a run die on a doomed model:
       - Gemini "live" / "live-extended-thinking" are WebSocket-only Live APIs
       - ":batch" / "-batch" variants use the Anthropic batch endpoint */
    .filter((m) => !/(^|[:\/])live([-:]|extended)|[:\-]batch\b|\binkling\b/i.test(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? 0,
      promptPrice: m.pricing?.prompt ?? '0',
      free: m.id.endsWith(':free') || m.pricing?.prompt === '0',
      supportsTools: true,
      vision: (m.architecture?.input_modalities ?? []).includes('image'),
    }))

  /* free first, then by context — the useful end of the list */
  models.sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1
    return b.contextLength - a.contextLength
  })

  catalogueCache = { at: Date.now(), models }
  return models
}
