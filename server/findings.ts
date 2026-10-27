import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, displayPath, getWorkspace } from './config.ts'
import { kbForRule } from './security-kb.ts'
import type { Finding, Severity } from './security-gate.ts'

/* ---------------------------------------------------------------------------
   The findings ledger.

   A scanner that reports the same twelve findings on every run teaches the
   reader to ignore it. The ledger keeps one row per real problem: a stable
   fingerprint (rule + file, not line number, because lines move), when it was
   first and last seen, and whether it is open, fixed or accepted.

   Seen again after being marked fixed → it comes back as open, with its first
   date intact. That is the honest behaviour: a re-appearing bug is not new,
   it is a regression, and the ledger says so by keeping the date.

   Scoped to the workspace, like sessions and the graph, so two projects never
   share a findings list.
   --------------------------------------------------------------------------- */

export type FindingStatus = 'open' | 'fixed' | 'accepted'

export interface LedgerFinding {
  id: string
  rule: string
  severity: Severity
  file: string
  line: number
  snippet: string
  /** the CWE page that explains it */
  kb: string | null
  status: FindingStatus
  firstSeenAt: number
  lastSeenAt: number
  note?: string
}

interface Ledger {
  version: 1
  workspace: string
  findings: LedgerFinding[]
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function ledgerPath(): string {
  const key = createHash('sha1').update(getWorkspace()).digest('hex').slice(0, 16)
  return join(DATA_DIR, `findings-${key}.json`)
}

function load(): Ledger {
  const empty: Ledger = { version: 1, workspace: getWorkspace(), findings: [] }
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Ledger
    if (parsed.version !== 1 || !Array.isArray(parsed.findings)) return empty
    return parsed
  } catch {
    return empty
  }
}

function save(ledger: Ledger): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const path = ledgerPath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(ledger))
    try {
      renameSync(tmp, path)
    } catch {
      writeFileSync(path, JSON.stringify(ledger))
    }
  } catch {
    /* a read-only data dir degrades to "no memory", never to a failed run */
  }
}

export function fingerprint(rule: string, file: string): string {
  return createHash('sha1').update(`${rule}\u0000${file.replace(/\\/g, '/')}`).digest('hex').slice(0, 12)
}

export interface RecordResult {
  added: number
  revived: number
  total: number
  open: number
  critical: number
}

/**
 * Fold a scan into the ledger.
 *
 * Rules that are no longer present are NOT auto-closed: a scan may have covered
 * only the files this run touched, and silently marking the rest "fixed" is a
 * lie. The reader closes them, or a full-workspace scan proves they are gone.
 */
export function recordFindings(findings: Finding[]): RecordResult {
  const ledger = load()
  const now = Date.now()
  const byId = new Map(ledger.findings.map((f) => [f.id, f]))
  let added = 0
  let revived = 0
  for (const f of findings) {
    const id = fingerprint(f.rule, f.file)
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, {
        id,
        rule: f.rule,
        severity: f.severity,
        file: f.file,
        line: f.line,
        snippet: f.snippet,
        kb: kbForRule(f.rule)?.id ?? null,
        status: 'open',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      added += 1
      continue
    }
    if (existing.status === 'fixed') revived += 1
    existing.severity = f.severity
    existing.line = f.line
    existing.snippet = f.snippet
    existing.lastSeenAt = now
    existing.kb = existing.kb ?? kbForRule(f.rule)?.id ?? null
    if (existing.status === 'fixed') existing.status = 'open'
  }
  const merged = [...byId.values()]
  save({ version: 1, workspace: getWorkspace(), findings: merged })
  const open = merged.filter((f) => f.status === 'open')
  return {
    added,
    revived,
    total: merged.length,
    open: open.length,
    critical: open.filter((f) => f.severity === 'critical').length,
  }
}

export function listFindings(status?: FindingStatus): LedgerFinding[] {
  const rows = load().findings
  const filtered = status ? rows.filter((f) => f.status === status) : rows
  return filtered.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.lastSeenAt - a.lastSeenAt,
  )
}

export function updateFinding(id: string, status: FindingStatus, note?: string): LedgerFinding | null {
  const ledger = load()
  const hit = ledger.findings.find((f) => f.id === id || f.id.startsWith(id))
  if (!hit) return null
  hit.status = status
  if (note !== undefined) hit.note = note.slice(0, 500)
  save(ledger)
  return hit
}

export function counts(): { open: number; critical: number; high: number; fixed: number; accepted: number } {
  const rows = load().findings
  const open = rows.filter((f) => f.status === 'open')
  return {
    open: open.length,
    critical: open.filter((f) => f.severity === 'critical').length,
    high: open.filter((f) => f.severity === 'high').length,
    fixed: rows.filter((f) => f.status === 'fixed').length,
    accepted: rows.filter((f) => f.status === 'accepted').length,
  }
}

/** the list, formatted so a model can act on it without another tool call */
export function formatLedger(status?: FindingStatus): string {
  const rows = listFindings(status)
  if (rows.length === 0) {
    return status === 'open'
      ? 'No open findings in this workspace. Run security_scan to look again.'
      : 'The findings ledger is empty for this workspace.'
  }
  const head = `${rows.length} finding(s)${status ? ` (${status})` : ''}:`
  const lines = rows.slice(0, 30).map((f) => {
    const where = f.file.startsWith(getWorkspace()) ? displayPath(f.file) : f.file
    const kb = f.kb ? ` [${f.kb}]` : ''
    const dates = f.status === 'fixed' ? ` · fixed after ${new Date(f.firstSeenAt).toISOString().slice(0, 10)}` : ''
    return `  ${f.id}  ${f.severity.toUpperCase()}  ${f.rule}${kb}  ${where}:${f.line}${dates}\n     ${f.snippet}\n     status: ${f.status}${f.note ? ` — ${f.note}` : ''}`
  })
  return [head, ...lines].join('\n')
}
