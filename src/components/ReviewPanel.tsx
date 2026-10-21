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
      {diff.trim() && <Block title="Diff" text={diff} clamp />}
      <Block title="Recent commits" text={log.trim() || 'no commits yet'} />
    </div>
  )
}
