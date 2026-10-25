import { useEffect, useState } from 'react'
import { api, type GitDiff } from '../lib/api'

/* ===========================================================================
   The diff pane.

   The reference's centrepiece: click `+N −N` and read exactly what changed.
   LOONG has had GET /api/git/diff since the beginning and never built the door.

   The pane is a real window over the real endpoint. If the folder is not a git
   repository it says so, rather than showing an empty pane and letting the
   reader wonder.
   =========================================================================== */

export function DiffPane({ onClose }: { onClose: () => void }) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    void api
      .gitDiff()
      .then(setDiff)
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false))
  }, [])

  const files = diff?.files ?? []
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0)
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0)

  return (
    <div className="absolute inset-0 z-50 flex flex-col" style={{ background: 'var(--canvas)' }}>
      <header
        className="flex h-[46px] shrink-0 items-center gap-[10px] px-[24px]"
        style={{ borderBottom: '1px solid var(--line-1)' }}
      >
        <h2 className="display m-0 flex-1 t-h3">Changes</h2>
        <span className="mono t-tiny" style={{ color: 'var(--text-4)' }}>
          +{added} −{removed}
        </span>
        <button
          type="button"
          className="ctl rounded-[6px] px-[9px] py-[4px] t-small"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy && (
          <p className="px-[24px] pt-[16px] t-small" style={{ color: 'var(--text-3)' }}>
            reading the repository…
          </p>
        )}

        {error && (
          <div className="px-[24px] pt-[16px]">
            <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
              {error}
            </p>
            <p className="m-0 mt-[4px] t-small" style={{ color: 'var(--text-3)' }}>
              The diff comes from git. If this folder is not a repository yet, there is nothing to
              show — and saying so is better than an empty pane.
            </p>
          </div>
        )}

        {!busy && !error && files.length === 0 && (
          <p className="px-[24px] pt-[16px] t-small" style={{ color: 'var(--text-3)' }}>
            No changes since the last commit.
          </p>
        )}

        {files.length > 0 && (
          <div className="flex flex-col">
            {files.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-[10px] px-[24px] py-[9px]"
                style={{ borderTop: '1px solid var(--line-1)' }}
              >
                <span className="mono min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-1)' }}>
                  {f.path}
                </span>
                <span className="mono t-tiny shrink-0" style={{ color: 'var(--text-3)' }}>
                  +{f.added} −{f.removed}
                </span>
              </div>
            ))}
          </div>
        )}

        {diff?.diff && (
          <pre
            className="mono m-0 overflow-x-auto px-[24px] py-[16px] t-code"
            style={{ color: 'var(--text-2)' }}
          >
            {diff.diff.length > 20000 ? `${diff.diff.slice(0, 20000)}\n… truncated` : diff.diff}
          </pre>
        )}
      </div>
    </div>
  )
}
