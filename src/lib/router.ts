import type { LocalModel, RemoteModel } from './api'

/* ---------------------------------------------------------------------------
   The router.

   Every leading agent in 2026 routes: Claude Code has its fast mode, Cursor
   picks a model per request, Codex ships with a default per plan. What none of
   them will do is send a tool job to a model that cannot call tools — which is
   exactly what a naive "cheapest model" router does, and why the failure is
   silent: the agent just… stops.

   So the floor is a hard rule here: only models that can call tools are ever
   routed to. Everything else is taste on top of that floor.

     fast — the quickest tool-capable model: a local one when there is one
            (no network, no queue, no bill), otherwise the free tier
     deep — the strongest: the provider's own suggestions, strongest first,
            then anything else remote, and only then a local model
     auto — reads the message: big refactors and "why" questions go deep,
            everything else goes fast
   --------------------------------------------------------------------------- */

export type Route = 'manual' | 'auto' | 'deep' | 'fast'

/** words that mean the message is a thinking job, not a typing job */
const DEEP_PATTERN =
  /\b(refactor|architect|design|migrat\w+|debug|why|explain|review|optimi[sz]e|security|performance|plan|root cause|trade.?offs?|redesign|rewrite)\b/i
/** code-shaped content usually means real work is attached */
const CODE_PATTERN = /```|function |class |import |def |SELECT |\.tsx?\b|\.py\b/i

export interface Routable {
  name: string
  supportsTools: boolean
  /** the model reads images — a message with a picture cannot go anywhere else */
  vision?: boolean
  /** a reasoning model: slower and stronger. The router prefers it for deep
      work and avoids it for fast work, for exactly those two reasons. */
  reasoning?: boolean
  free?: boolean
  /** bigger context is a reasonable proxy for a stronger model */
  contextLength?: number
  /** too small / too shallow to drive an agent loop — never routed to */
  weak?: boolean
}

/**
 * A model that will "think dumb" and can produce wrong output: tiny parameter
 * counts, tiny context, or a lite/nano variant. The router treats these as
 * ineligible for agent work — a weak model is a footgun, not a bargain.
 */
export function isWeakModel(name: string, contextLength?: number): boolean {
  if (/(^|[:\/@-])(0\.\d+b|1b|1\.5b|2b|3b)(?![0-9])/i.test(name)) return true
  if (/[:/@-](nano|tiny|flash-lite)\b/i.test(name)) return true
  if (typeof contextLength === 'number' && contextLength > 0 && contextLength < 8_000) return true
  return false
}

/** true when this message deserves the strong model */
export function isDeepMessage(text: string): boolean {
  if (text.length > 600) return true
  if (CODE_PATTERN.test(text) && text.length > 200) return true
  return DEEP_PATTERN.test(text)
}

/** the floor, applied before any preference: tool calling always, and vision
 *  when the message carries a picture. A router that ignores either sends the
 *  run to a model that cannot do the job — and the failure is silent. */
function capable(
  local: Routable[],
  remote: Routable[],
  needsVision = false,
): { local: Routable[]; remote: Routable[] } {
  const ok = (m: Routable) => m.supportsTools && !m.weak && (!needsVision || m.vision === true)
  return { local: local.filter(ok), remote: remote.filter(ok) }
}

/** free models known to actually run through the chat/completions path —
 *  the catalogue changes weekly, so this is a preference, not a guarantee */
const PREFERRED_FREE = [
  'openai/gpt-oss-20b:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-s-2.1:free',
]

/** pick the quickest tool-capable model, or null when there is none */
export function pickFast(local: Routable[], remote: Routable[], needsVision = false): string | null {
  const { local: l, remote: r } = capable(local, remote, needsVision)
  /* speed means no thinking pause: a reasoning model is the wrong tool for
     "rename this" even when it is the best tool for "why is this slow" */
  const quick = r.filter((m) => m.reasoning !== true)
  if (l.length > 0) return l[0].name
  /* prefer a free model that is known to work — the raw catalogue order can
     lead with a harness-gated entry that fails on the first token */
  const preferred = PREFERRED_FREE.map((id) => quick.find((m) => m.name === id)).find(
    (m): m is Routable => Boolean(m),
  )
  const free = quick.find((m) => m.free)
  return (preferred ?? free ?? quick[0] ?? r[0])?.name ?? null
}

/** pick the strongest tool-capable model, or null when there is none */
export function pickDeep(local: Routable[], remote: Routable[], needsVision = false): string | null {
  const { local: l, remote: r } = capable(local, remote, needsVision)
  /* the frontier is paid and wide: rank by (reasoning, not free, context) —
     the catalogue arrives free-first, so its order is not a strength order */
  const ranked = [...r].sort((a, b) => {
    if (Boolean(a.reasoning) !== Boolean(b.reasoning)) return a.reasoning ? -1 : 1
    if (Boolean(a.free) !== Boolean(b.free)) return a.free ? 1 : -1
    return (b.contextLength ?? 0) - (a.contextLength ?? 0)
  })
  if (ranked.length > 0) return ranked[0].name
  return l[0]?.name ?? null
}

/**
 * The model for this run. Returns null when the router has nothing to say —
 * the caller then uses whatever is configured, which is the only honest
 * fallback when the floor leaves nothing standing.
 */
export function pickModel(
  route: Route,
  message: string,
  local: Routable[],
  remote: Routable[],
  /** how many images the message carries — a picture is a hard requirement,
      not a preference */
  images = 0,
): string | null {
  if (route === 'manual') return null
  const needsVision = images > 0
  if (route === 'fast') return pickFast(local, remote, needsVision)
  if (route === 'deep') return pickDeep(local, remote, needsVision)
  return isDeepMessage(message) ? pickDeep(local, remote, needsVision) : pickFast(local, remote, needsVision)
}

/** the models the router may choose from, from the two lists the app already holds */
export function routableFrom(
  local: LocalModel[],
  remote: RemoteModel[],
): { local: Routable[]; remote: Routable[] } {
  return {
    local: local.map((m) => ({
      name: m.name,
      supportsTools: m.supportsTools,
      weak: isWeakModel(m.name),
    })),
    remote: remote.map((m) => ({
      name: m.id,
      supportsTools: m.supportsTools,
      free: m.free,
      contextLength: m.contextLength,
      vision: m.vision,
      reasoning: m.reasoning,
      weak: isWeakModel(m.id, m.contextLength),
    })),
  }
}

export const ROUTE_LABEL: Record<Route, string> = {
  manual: 'Manual',
  auto: 'Auto',
  fast: 'Fast',
  deep: 'Deep',
}
