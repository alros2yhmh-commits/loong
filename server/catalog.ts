/* ---------------------------------------------------------------------------
   The model catalog.

   Every provider has a list of models, and until now Loong knew one of them:
   OpenRouter's. Picking Google or Anthropic meant typing a model name from
   memory and hoping. models.dev — the same open catalog OpenCode is built on —
   publishes every provider's models with what they can do: tool calling,
   images, reasoning, context length, price.

   So: pick a provider, and the list appears. No typing, no guessing.
   --------------------------------------------------------------------------- */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.ts'
import type { ProviderId } from './providers.ts'

const CATALOG_URL = 'https://models.dev/api.json'
/** a day: the catalog changes weekly, and a stale list is worse than a fetch */
const TTL_MS = 24 * 60 * 60 * 1000

export interface CatalogModel {
  id: string
  name: string
  /** can it read images — the router needs this for a message with a picture */
  vision: boolean
  /** can it call tools — an agent model without this is a chat toy */
  tools: boolean
  reasoning: boolean
  /** context window in tokens, when the catalog knows it */
  context: number | null
  /** USD per million tokens, when known — shown, never used to decide */
  priceIn: number | null
  priceOut: number | null
  family: string | null
}

/** our provider ids → the catalog's ids */
const CATALOG_IDS: Partial<Record<ProviderId, string>> = {
  google: 'google',
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
}

type RawCatalog = Record<string, { models?: Record<string, Record<string, unknown>> }>

let memory: { at: number; data: RawCatalog } | null = null

function cacheFile(): string {
  return join(DATA_DIR, 'model-catalog.json')
}

function readCache(): RawCatalog | null {
  try {
    const raw = readFileSync(cacheFile(), 'utf8')
    const parsed = JSON.parse(raw) as { at: number; data: RawCatalog }
    if (Date.now() - parsed.at > TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(data: RawCatalog): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), data }), 'utf8')
  } catch {
    /* a read-only data dir must not take the agent down */
  }
}

/** fetch the catalog — memory, then disk, then the network */
export async function loadCatalog(force = false): Promise<RawCatalog> {
  if (!force && memory) return memory.data
  if (!force) {
    const disk = readCache()
    if (disk) {
      memory = { at: Date.now(), data: disk }
      return disk
    }
  }
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`the model catalog answered ${res.status}`)
  const data = (await res.json()) as RawCatalog
  memory = { at: Date.now(), data }
  writeCache(data)
  return data
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** the models of one provider, as the picker and the router read them */
export function modelsOf(catalog: RawCatalog, provider: ProviderId): CatalogModel[] {
  const id = CATALOG_IDS[provider]
  if (!id) return []
  const raw = catalog[id]?.models ?? {}
  const out: CatalogModel[] = []
  for (const [modelId, m] of Object.entries(raw)) {
    const cost = (m.cost ?? {}) as Record<string, unknown>
    const limit = (m.limit ?? {}) as Record<string, unknown>
    out.push({
      id: typeof m.id === 'string' ? m.id : modelId,
      name: typeof m.name === 'string' ? m.name : modelId,
      vision: m.attachment === true,
      tools: m.tool_call === true,
      reasoning: m.reasoning === true,
      context: num(limit.context),
      priceIn: num(cost.input),
      priceOut: num(cost.output),
      family: typeof m.family === 'string' ? m.family : null,
    })
  }
  return out
}
