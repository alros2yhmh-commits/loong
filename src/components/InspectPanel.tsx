import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type FindingCounts, type GraphStats, type LedgerFinding } from '../lib/api'
import { t, e } from '../lib/motion'

/* ===========================================================================
   Inspect — the two facts about a project that are not in the transcript.

   Graph: what the agent indexed, so "the codebase" is a countable thing and
   not a feeling. Security: the ledger, so a finding has a life (open, fixed,
   accepted) instead of being a paragraph that scrolls away.

   Both are reads against the local server, and both can be refreshed from
   here. The panel is a dialog with a real Escape, because a panel that traps
   the keyboard is a panel you stop opening.
   =========================================================================== */

export type InspectTab = 'graph' | 'security'

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--fail)',
  high: 'var(--amber)',
  medium: 'var(--text-1)',
  low: 'var(--text-3)',
}

function short(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/')
}

export function InspectPanel({
  tab,
  workspace,
  onClose,
  onTab,
}: {
  tab: InspectTab
  workspace: string | null
  onClose: () => void
  onTab: (tab: InspectTab) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [map, setMap] = useState('')
  const [findings, setFindings] = useState<LedgerFinding[]>([])
  const [counts, setCounts] = useState<FindingCounts | null>(null)
  const [busy, setBusy] = useState<'' | 'graph' | 'scan'>('')
  const [error, setError] = useState('')

  const loadGraph = useCallback(
    async (refresh: boolean) => {
      if (!workspace) return
      setBusy('graph')
      setError('')
      try {
        const r = await api.graph(refresh)
        setStats(r.stats)
        setMap(r.map)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy('')
      }
    },
    [workspace],
  )

  const loadFindings = useCallback(async () => {
    if (!workspace) return
    try {
      const r = await api.findings()
      setFindings(r.findings)
      setCounts(r.counts)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [workspace])

  const scan = useCallback(async () => {
    if (!workspace) return
    setBusy('scan')
    setError('')
    try {
      await api.securityScan()
      await loadFindings()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('')
    }
  }, [workspace, loadFindings])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    if (tab === 'graph') void loadGraph(false)
    else void loadFindings()
  }, [tab, loadGraph, loadFindings])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mark = async (id: string, status: LedgerFinding['status']) => {
    try {
      const r = await api.updateFinding(id, status)
      setFindings((prev) => prev.map((f) => (f.id === id ? r.finding : f)))
      setCounts(r.counts)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[9vh]"
      style={{ background: 'rgba(0,0,0,0.42)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: t.fast, ease: e.out }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Inspect project"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.995 }}
        transition={{ duration: t.base, ease: e.out }}
        className="flex max-h-[76vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-[14px]"
        style={{ background: 'var(--raised)', border: '1px solid var(--line-2)' }}
      >
        <header
          className="flex items-center gap-[8px] px-[12px] py-[9px]"
          style={{ borderBottom: '1px solid var(--line-1)' }}
        >
          {/* One obvious way out, on the left where every desktop panel puts
              it. The Escape key still works; a button labelled "Esc" was a
              keyboard hint pretending to be a control. */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Back to the conversation"
            title="Back to the conversation — Esc"
            className="ctl flex shrink-0 items-center gap-[5px] rounded-[7px] px-[7px] py-[4px] t-tiny"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.5L5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back
          </button>
          <span className="shrink-0 t-small" style={{ color: 'var(--text-2)' }}>
            Inspect
          </span>
          <span className="t-tiny" style={{ color: 'var(--text-4)' }}>/</span>
          {(['graph', 'security'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onTab(id)}
              aria-pressed={tab === id}
              className="ctl shrink-0 rounded-[7px] px-[9px] py-[3px] t-tiny capitalize"
              style={{
                color: tab === id ? 'var(--text-1)' : 'var(--text-3)',
                background: tab === id ? 'var(--surface)' : 'transparent',
                border: `1px solid ${tab === id ? 'var(--line-2)' : 'transparent'}`,
              }}
            >
              {id === 'graph' ? 'Graph' : 'Security'}
            </button>
          ))}
          <span className="mono ml-[2px] min-w-0 truncate t-tiny" style={{ color: 'var(--text-4)' }}>
            {workspace ? short(workspace) : 'no folder open'}
          </span>
          <span className="flex-1" />
          {tab === 'graph' && (
            <button
              type="button"
              onClick={() => void loadGraph(true)}
              disabled={busy !== '' || !workspace}
              className="ctl shrink-0 rounded-[7px] px-[9px] py-[3px] t-tiny"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
            >
              {busy === 'graph' ? 'indexing…' : 'Re-index'}
            </button>
          )}
          {tab === 'security' && (
            <button
              type="button"
              onClick={() => void scan()}
              disabled={busy !== '' || !workspace}
              className="ctl shrink-0 rounded-[7px] px-[9px] py-[3px] t-tiny"
              style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
            >
              {busy === 'scan' ? 'scanning…' : 'Scan now'}
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[13px]">
          {!workspace && (
            <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
              Open a folder first — both panels describe the folder the agent is working in.
            </p>
          )}
          {error && (
            <p className="m-0 mb-[10px] t-small" style={{ color: 'var(--fail)' }}>
              {error}
            </p>
          )}

          {workspace && tab === 'graph' && (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key="graph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {!stats && busy === '' && (
                  <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
                    No index yet. Press Re-index (or ask the agent for graph_map).
                  </p>
                )}
                {stats && (
                  <>
                    <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
                      {[
                        ['source files', stats.sourceFiles],
                        ['symbols', stats.symbols],
                        ['imports', stats.edges],
                        ['cycles', stats.cycles],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-[9px] px-[10px] py-[8px]" style={{ border: '1px solid var(--line-1)' }}>
                          <p className="mono m-0 t-tiny" style={{ color: 'var(--text-3)' }}>{label}</p>
                          <p className="m-0 t-h2" style={{ color: 'var(--text-1)' }}>{value}</p>
                        </div>
                      ))}
                    </div>
                    {stats.languages.length > 0 && (
                      <p className="mono m-0 mt-[10px] t-tiny" style={{ color: 'var(--text-3)' }}>
                        {stats.languages.slice(0, 8).map((l) => `${l.lang} ${l.count}`).join('  ·  ')}
                      </p>
                    )}
                    {stats.entries.length > 0 && (
                      <p className="mono m-0 mt-[4px] t-tiny" style={{ color: 'var(--text-3)' }}>
                        entry points: {stats.entries.slice(0, 6).join(', ')}
                      </p>
                    )}
                    <pre
                      className="mono m-0 mt-[12px] overflow-x-auto whitespace-pre-wrap break-words rounded-[9px] p-[11px] t-tiny leading-[1.6]"
                      style={{ background: 'var(--surface)', border: '1px solid var(--line-1)', color: 'var(--text-2)' }}
                    >
                      {map}
                    </pre>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          )}

          {workspace && tab === 'security' && (
            <div>
              <p className="mono m-0 mb-[10px] t-tiny" style={{ color: 'var(--text-3)' }}>
                {counts
                  ? `${counts.open} open · ${counts.critical} critical · ${counts.high} high · ${counts.fixed} fixed · ${counts.accepted} accepted`
                  : 'no scan yet'}
              </p>
              {findings.length === 0 && (
                <p className="m-0 t-small" style={{ color: 'var(--text-2)' }}>
                  The ledger is empty. Scan now, or ask the agent to run security_scan — findings are recorded either way.
                </p>
              )}
              <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
                {findings.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-[9px] px-[11px] py-[8px]"
                    style={{
                      borderLeft: `2px solid ${SEVERITY_COLOR[f.severity] ?? 'var(--line-3)'}`,
                      border: '1px solid var(--line-1)',
                      borderLeftWidth: 2,
                      opacity: f.status === 'open' ? 1 : 0.55,
                    }}
                  >
                    <div className="flex flex-wrap items-baseline gap-[8px]">
                      <span className="mono t-tiny uppercase tracking-[0.1em]" style={{ color: SEVERITY_COLOR[f.severity] ?? 'var(--text-2)' }}>
                        {f.severity}
                      </span>
                      <span className="mono t-tiny" style={{ color: 'var(--text-2)' }}>{f.rule}</span>
                      {f.kb && <span className="mono t-tiny" style={{ color: 'var(--text-3)' }}>{f.kb}</span>}
                      <span className="flex-1" />
                      <span className="mono t-tiny" style={{ color: 'var(--text-3)' }}>{f.status}</span>
                    </div>
                    <p className="mono m-0 mt-[3px] t-tiny" style={{ color: 'var(--text-3)' }}>
                      {short(f.file)}{f.line ? `:${f.line}` : ''} · first seen {new Date(f.firstSeenAt).toLocaleDateString('en-GB')}
                    </p>
                    {f.snippet && (
                      <pre className="mono m-0 mt-[4px] overflow-x-auto whitespace-pre-wrap break-words t-tiny" style={{ color: 'var(--text-2)' }}>
                        {f.snippet}
                      </pre>
                    )}
                    {f.status === 'open' ? (
                      <div className="mt-[6px] flex gap-[5px]">
                        <button
                          type="button"
                          onClick={() => void mark(f.id, 'fixed')}
                          className="ctl rounded-[6px] px-[8px] py-[2px] t-tiny"
                          style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
                        >
                          Mark fixed
                        </button>
                        <button
                          type="button"
                          onClick={() => void mark(f.id, 'accepted')}
                          className="ctl rounded-[6px] px-[8px] py-[2px] t-tiny"
                          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                        >
                          Accept risk
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void mark(f.id, 'open')}
                        className="ctl mt-[6px] rounded-[6px] px-[8px] py-[2px] t-tiny"
                        style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
                      >
                        Reopen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
