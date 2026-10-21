import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/* ---------------------------------------------------------------------------
   Analytics — what the runs actually cost.

   ChatGPT 2026 ships "Personal Analytics"; this is Loong's local version, read
   from the traces it already records: how many runs, how they ended, average
   time and tokens, and the slowest tools. No telemetry, no network.
   --------------------------------------------------------------------------- */

interface Stats {
  runs: number
  ok: number
  errors: number
  aborted: number
  avgMs: number
  avgPromptTokens: number
  avgCompletionTokens: number
  slowest: { tool: string; totalMs: number; calls: number }[]
}

export function AnalyticsPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void api
      .traces()
      .then((r) => {
        if (alive) setStats(r.stats)
      })
      .catch((e) => {
        if (alive) setError((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <p className="mono m-0 text-[11px]" style={{ color: 'var(--text-4)' }}>
        {error}
      </p>
    )
  }
  if (!stats || stats.runs === 0) {
    return (
      <p className="m-0 text-[11.5px] leading-[1.6]" style={{ color: 'var(--text-4)' }}>
        No runs measured yet. Every run records its time, tokens and tools — start one and
        come back.
      </p>
    )
  }

  const tiles: [string, string][] = [
    ['runs', String(stats.runs)],
    ['ok', String(stats.ok)],
    ['errors', String(stats.errors)],
    ['aborted', String(stats.aborted)],
    ['avg time', `${(stats.avgMs / 1000).toFixed(1)}s`],
    ['avg tokens', (stats.avgPromptTokens + stats.avgCompletionTokens).toLocaleString()],
  ]

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-3 gap-[6px]">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-[6px] px-[9px] py-[7px]" style={{ border: '1px solid var(--line-2)' }}>
            <p className="mono m-0 text-[9.5px] tracking-[0.06em] uppercase" style={{ color: 'var(--text-4)' }}>
              {k}
            </p>
            <p className="m-0 mt-[1px] text-[14px]" style={{ color: 'var(--text-1)' }}>
              {v}
            </p>
          </div>
        ))}
      </div>
      {stats.slowest.length > 0 && (
        <div>
          <p className="mono m-0 mb-[4px] text-[10px] tracking-[0.08em] uppercase" style={{ color: 'var(--text-4)' }}>
            slowest tools
          </p>
          {stats.slowest.map((s) => (
            <div
              key={s.tool}
              className="mono flex justify-between gap-[8px] text-[10.5px]"
              style={{ color: 'var(--text-3)' }}
            >
              <span className="truncate">
                {s.tool} · {s.calls}×
              </span>
              <span className="shrink-0">{(s.totalMs / 1000).toFixed(1)}s</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
