import type { Finding } from './security-gate.ts'

/* ---------------------------------------------------------------------------
   Security Puff — the adversarial layer (red team).

   The rule is the same one the whole product follows: the agent may attack
   only the reader's own machine. This tool accepts a base URL, refuses
   anything that is not loopback, and sends a handful of GET requests at the
   surface a careless server exposes: debug files, a git directory, a listing,
   missing security headers.

   It is not a scanner and does not pretend to be. A request that returns 200
   is evidence; a request that returns 404 is evidence of nothing, and the
   report says so rather than claiming the app is clean.
   --------------------------------------------------------------------------- */

const MAX_BODY = 200_000
const TIMEOUT_MS = 6_000

/** paths that are dangerous to serve and cheap to check */
const EXPOSED: { path: string; rule: string; sev: Finding['severity']; test: (body: string, type: string) => boolean; note: string }[] = [
  {
    path: '/.env',
    rule: 'exposed-env',
    sev: 'critical',
    test: (b) => /^[A-Z][A-Z0-9_]{2,}\s*=/m.test(b) && !/<!doctype|<html/i.test(b),
    note: 'environment file served — every secret in it is readable',
  },
  {
    path: '/.git/HEAD',
    rule: 'exposed-git',
    sev: 'critical',
    test: (b) => /^ref:\s+refs\//m.test(b),
    note: 'the git directory is served — full source history is downloadable',
  },
  {
    path: '/package.json',
    rule: 'exposed-manifest',
    sev: 'low',
    test: (b) => {
      try {
        const j = JSON.parse(b) as { dependencies?: unknown }
        return Boolean(j.dependencies) || Boolean((j as { name?: unknown }).name)
      } catch {
        return false
      }
    },
    note: 'the dependency manifest is served — versions are known to an attacker',
  },
  {
    path: '/.aws/credentials',
    rule: 'exposed-credentials',
    sev: 'critical',
    test: (b) => /aws_access_key_id/i.test(b),
    note: 'cloud credentials served as a file',
  },
]

const HEADERS: { name: string; rule: string; sev: Finding['severity']; ok: (v: string | null, all: Headers) => boolean; note: string }[] = [
  {
    name: 'content-security-policy',
    rule: 'missing-csp',
    sev: 'medium',
    ok: (v) => Boolean(v && /default-src|script-src/i.test(v)),
    note: 'no Content-Security-Policy — any injected script runs',
  },
  {
    name: 'x-frame-options',
    rule: 'missing-frame-guard',
    sev: 'medium',
    ok: (v, all) => Boolean(v) || /frame-ancestors/i.test(all.get('content-security-policy') ?? ''),
    note: 'no frame protection — the app can be embedded in a clickjacking page',
  },
  {
    name: 'x-content-type-options',
    rule: 'missing-nosniff',
    sev: 'low',
    ok: (v) => (v ?? '').toLowerCase().includes('nosniff'),
    note: 'no X-Content-Type-Options — a browser may sniff a response into a script',
  },
  {
    name: 'referrer-policy',
    rule: 'missing-referrer-policy',
    sev: 'low',
    ok: (v) => Boolean(v),
    note: 'no Referrer-Policy — URLs (which may contain ids) leak to third parties',
  },
]

function loopbackBase(raw: string): URL {
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const ok = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  if (!ok) {
    throw new Error(
      `Refused: red_team only probes this machine (127.0.0.1, localhost or ::1). "${url.hostname}" is a third party.`,
    )
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Refused: only http and https are probed.')
  return url
}

async function fetchBounded(url: string): Promise<{ status: number; headers: Headers; body: string; type: string } | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'user-agent': 'loong-red-team/local', accept: '*/*' },
    })
    const type = r.headers.get('content-type') ?? ''
    let body = ''
    if (!/^(?:image|audio|video|font)\//i.test(type)) {
      const reader = r.body?.getReader()
      if (reader) {
        const chunks: Uint8Array[] = []
        let size = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done || !value) break
          chunks.push(value)
          size += value.length
          if (size >= MAX_BODY) {
            await reader.cancel().catch(() => {})
            break
          }
        }
        body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
      }
    }
    return { status: r.status, headers: r.headers, body, type }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface RedTeamResult {
  target: string
  probed: number
  findings: Finding[]
  report: string
}

/**
 * Probe one loopback origin.
 *
 * `paths` lets a caller narrow the surface (a route it cares about). The default
 * is the exposed-file list plus the security headers. Nothing else is sent: no
 * POST, no payloads, no fuzzing — this is a mirror held up to the reader's own
 * server, not an attack tool.
 */
export async function redTeam(baseUrl: string, paths?: string[]): Promise<RedTeamResult> {
  const base = loopbackBase(baseUrl)
  const findings: Finding[] = []
  let probed = 0
  const lines: string[] = []
  const origin = base.origin

  const root = await fetchBounded(origin + '/')
  probed += 1
  if (!root) {
    return {
      target: origin,
      probed,
      findings,
      report: `Could not reach ${origin} — is the server running? Nothing was probed, so nothing is proven.`,
    }
  }

  for (const h of HEADERS) {
    if (h.ok(root.headers.get(h.name), root.headers)) continue
    findings.push({
      severity: h.sev,
      rule: h.rule,
      file: origin,
      line: 0,
      snippet: `${h.note} (${h.name} absent on GET /)`,
    })
    lines.push(`  ${h.sev.toUpperCase()} · ${h.rule} — ${h.note}`)
  }

  const server = root.headers.get('server') ?? root.headers.get('x-powered-by')
  if (server) {
    findings.push({
      severity: 'low',
      rule: 'banner-disclosure',
      file: origin,
      line: 0,
      snippet: `server banner: ${server}`,
    })
    lines.push(`  LOW · banner-disclosure — the response names its stack: ${server}`)
  }

  const listing = /<title>\s*Index of \//i.test(root.body)
  if (listing) {
    findings.push({
      severity: 'medium',
      rule: 'directory-listing',
      file: `${origin}/`,
      line: 0,
      snippet: 'directory listing is enabled at the root',
    })
    lines.push('  MEDIUM · directory-listing — the root serves a file listing')
  }

  const custom = paths?.length ? paths : EXPOSED.map((e) => e.path)
  for (const path of custom.slice(0, 12)) {
    const p = path.startsWith('/') ? path : `/${path}`
    const hit = await fetchBounded(origin + p)
    probed += 1
    if (!hit || hit.status !== 200 || hit.body.length === 0) continue
    const spec = EXPOSED.find((e) => e.path === p)
    if (spec && spec.test(hit.body, hit.type)) {
      findings.push({
        severity: spec.sev,
        rule: spec.rule,
        file: `${origin}${p}`,
        line: 0,
        snippet: spec.note,
      })
      lines.push(`  ${spec.sev.toUpperCase()} · ${spec.rule} — ${p}: ${spec.note}`)
    } else if (!spec) {
      lines.push(`  note · ${p} answered 200 (${hit.type || 'no type'}) — check by hand whether it should be public`)
    }
  }

  const report = [
    `Red team on ${origin}: ${probed} request(s), ${findings.length} finding(s).`,
    ...(lines.length ? lines : ['  No header or exposed-file problem found. That is not "secure" — it means this probe found nothing.']),
    '',
    'Everything probed was this machine only. Paths that answered 404 prove nothing; paths that answered 200 are evidence.',
  ].join('\n')

  return { target: origin, probed, findings, report }
}
