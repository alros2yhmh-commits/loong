import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   Review — the repository as it is, read-only.

   ChatGPT 2026 brings PRs, diffs and checks into one place; this is Loong's
   version, scoped to the local working tree: status, diff stat, the diff, and
   recent commits. Read-only on purpose — nothing here changes the repo.
   --------------------------------------------------------------------------- */

function Block({ title, text, clamp = false }: { title: string; text: string; clamp?: boolean }) {
  const shown = clamp && text.length > 6000 ? `${text.slice(0, 6000)}\n… (${text.length - 6000} more chars)` : text
  return (
    <div>
      <p className="mono m-0 mb-[4px] text-[10px] tracking-[0.08em] uppercase" style={{ color: 'var(--text-4)' }}>
        {title}
      </p>
      <pre
        dir="auto"
        className="bidi mono m-0 overflow-auto rounded-[6px] px-[9px] py-[7px] text-[10.5px] leading-[1.6]"
        style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line-2)', whiteSpace: 'pre-wrap', maxHeight: 320 }}
      >
        {shown}
      </pre>
    </div>
  )
}

/** the diff, as a heatmap: one bar per file, width and density by churn.
 *  A stat line says "3 files changed"; this says WHICH one is the risk. */
function changeHeat(diff: string): { path: string; add: number; del: number }[] {
  const files: { path: string; add: number; del: number }[] = []
  let cur: { path: string; add: number; del: number } | null = null
  for (const line of diff.split('\n')) {
    const m = /^diff --git a\/(.+?) b\//.exec(line)
    if (m) {
      cur = { path: m[1], add: 0, del: 0 }
      files.push(cur)
      continue
    }
    if (!cur) continue
    if (line.startsWith('+') && !line.startsWith('+++')) cur.add += 1
    if (line.startsWith('-') && !line.startsWith('---')) cur.del += 1
  }
  return files
}

export function ReviewPanel() {
  const [status, setStatus] = useState('')
  const [stat, setStat] = useState('')
  const [diff, setDiff] = useState('')
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, d, l] = await Promise.all([api.gitStatus(), api.gitDiff(), api.gitLog()])
      if (!s.ok) setError(s.error ?? 'Could not read the repository.')
      setStatus(s.status ?? '')
      setStat(d.stat ?? '')
      setDiff(d.diff ?? '')
      setLog(l.log ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-[11px]">
      <div className="flex items-center justify-between">
        <span className="mono text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          {loading ? 'reading…' : 'working tree'}
        </span>
        <button
          type="button"
          className="ctl rounded-[5px] px-[7px] py-[2px] text-[10.5px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={() => void load()}
        >
          refresh
        </button>
      </div>

      {error && (
        <p className="mono m-0 text-[10.5px] leading-[1.55]" style={{ color: 'var(--text-3)' }}>
          {error}
        </p>
      )}

      <Block title="Status" text={status.trim() || 'clean — nothing changed'} />
      {stat.trim() && <Block title="Diff stat" text={stat.trim()} />}
      {(() => {
        const heat = changeHeat(diff)
        if (heat.length === 0) return null
        const max = Math.max(...heat.map((f) => f.add + f.del), 1)
        return (
          <div>
            <p
              className="mono m-0 mb-[5px] text-[10px] tracking-[0.08em] uppercase"
              style={{ color: 'var(--text-4)' }}
            >
              change heat
            </p>
            <div className="flex flex-col gap-[3px]">
              {heat.slice(0, 12).map((f) => {
                const total = f.add + f.del
                const weight = total / max
                return (
                  <div key={f.path} className="flex items-center gap-[8px]">
                    <span
                      className="mono min-w-0 flex-1 truncate text-[10px]"
                      style={{ color: 'var(--text-3)' }}
                      title={f.path}
                    >
                      {f.path}
                    </span>
                    <div
                      className="h-[4px] w-[110px] shrink-0 overflow-hidden rounded-[2px]"
                      style={{ background: 'var(--line-1)' }}
                    >
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(6, Math.round(weight * 100))}%`,
                          background: 'var(--text-2)',
                          opacity: 0.35 + 0.65 * weight,
                        }}
                      />
                    </div>
                    <span
                      className="mono w-[54px] shrink-0 text-right text-[9.5px]"
                      style={{ color: 'var(--text-4)' }}
                    >
                      +{f.add} −{f.del}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
      {diff.trim() && <Block title="Diff" text={diff} clamp />}
      <Block title="Recent commits" text={log.trim() || 'no commits yet'} />
    </div>
  )
}
