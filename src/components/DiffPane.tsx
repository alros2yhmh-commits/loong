import { useEffect, useMemo, useState } from 'react'
import { api, type GitDiff } from '../lib/api'

/* ===========================================================================
   The diff pane.

   A real window over GET /api/git/diff: per-file totals, the patch itself,
   and an honest answer when the folder is not a repository. The endpoint
   answers 200 with `ok:false` on a git failure, so the pane has to read the
   body — treating it as success was why the button looked like it did nothing.
   =========================================================================== */

/** split a unified diff into one patch per file, keyed by the b/ path */
function splitPatch(diff: string): Map<string, string> {
  const out = new Map<string, string>()
  const parts = diff.split(/^diff --git /m)
  for (const part of parts.slice(1)) {
    const m = /^a\/(.+?) b\/(.+)\n/.exec(part)
    if (!m) continue
    out.set(m[2], `diff --git ${part}`)
  }
  return out
}

export function DiffPane({
  onClose,
  workspace,
  onCount,
}: {
  onClose: () => void
  workspace: string | null
  /** how many files changed — the header badge reads this */
  onCount?: (n: number) => void
}) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    setBusy(true)
    setError(null)
    void api
      .gitDiff()
      .then((r) => {
        if (r.ok === false) setError(r.error ?? 'git did not answer')
        else setDiff(r)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false))
  }, [nonce])

  /* Escape is the way out of every surface; the header button was the only
     way out of this one */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const files = diff?.files ?? []
  const patches = useMemo(() => splitPatch(diff?.diff ?? ''), [diff])
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0)
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0)

  /* the count belongs to the caller: the Changes button shows HOW MANY files,
     which is the difference between "nothing happened" and "three files" */
  useEffect(() => {
    onCount?.(files.length)
  }, [files.length, onCount])

  const copyPatch = () => {
    const text = diff?.diff ?? ''
    if (!text) return
    void navigator.clipboard?.writeText(text).catch(() => {})
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Changes"
      className="absolute inset-0 z-50 flex flex-col"
      style={{ background: 'var(--canvas)' }}
    >
      {/* The native min / max / close buttons are painted over the top-right
          corner of this window. A pane that reaches into that strip loses its
          own buttons under them, so the header stops 146px short — the same
          inset the title bar uses. */}
      <header
        className="flex h-[46px] shrink-0 items-center gap-[10px] pl-[12px] pr-[146px]"
        style={{ borderBottom: '1px solid var(--line-1)' }}
      >
        <button
          type="button"
          className="ctl grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
          onClick={onClose}
          aria-label="Back to the conversation"
          title="Back to the conversation — Esc"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M9.5 3.5L5 8l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="display m-0 shrink-0 t-h3">Changes</h2>
        <span className="mono shrink-0 t-tiny" style={{ color: 'var(--text-3)' }}>
          +{added} −{removed}
        </span>
        <span
          className="min-w-0 flex-1 truncate mono t-tiny"
          style={{ color: 'var(--text-4)' }}
          title={workspace ?? ''}
        >
          {workspace ?? 'no folder open'}
        </span>
        <button
          type="button"
          className="ctl grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
          onClick={() => setNonce((n) => n + 1)}
          aria-label="Refresh changes"
          title="Reload the diff"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8V5h-2.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="ctl grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] disabled:opacity-40"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-2)' }}
          onClick={copyPatch}
          disabled={!diff?.diff}
          aria-label="Copy the patch"
          title="Copy the unified diff"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 5.5V3.9A1.4 1.4 0 0 0 9.1 2.5H3.9A1.4 1.4 0 0 0 2.5 3.9v5.2a1.4 1.4 0 0 0 1.4 1.4h1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy && (
          <p className="px-[24px] pt-[16px] t-small" style={{ color: 'var(--text-3)' }}>
            reading the repository…
          </p>
        )}

        {error && !busy && (
          <div className="px-[24px] pt-[16px]">
            <p className="m-0 t-small" style={{ color: 'var(--text-1)' }}>
              {error}
            </p>
            <p className="m-0 mt-[4px] t-small leading-[1.6]" style={{ color: 'var(--text-3)' }}>
              The diff comes from git in {workspace ?? 'the open folder'}. If it is not a repository
              yet, run <span className="mono">git init</span> there — or open the folder that is one.
            </p>
          </div>
        )}

        {!busy && !error && files.length === 0 && (
          <p className="px-[24px] pt-[16px] t-small" style={{ color: 'var(--text-3)' }}>
            No changes since the last commit in {workspace ?? 'this folder'}.
          </p>
        )}

        {!busy && !error && files.length > 0 && (
          <div className="flex flex-col">
            {files.map((f) => {
              const patch = patches.get(f.path)
              const expanded = open[f.path] ?? false
              return (
                <div key={f.path} style={{ borderTop: '1px solid var(--line-1)' }}>
                  <button
                    type="button"
                    className="ctl flex w-full items-center gap-[10px] px-[24px] py-[9px] text-left"
                    onClick={() => setOpen((prev) => ({ ...prev, [f.path]: !expanded }))}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} the patch for ${f.path}`}
                  >
                    <span className="mono w-[10px] shrink-0 t-tiny" style={{ color: 'var(--text-4)' }}>
                      {patch ? (expanded ? '▾' : '▸') : ''}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate t-small" style={{ color: 'var(--text-1)' }}>
                      {f.path}
                    </span>
                    <span className="mono t-tiny shrink-0" style={{ color: 'var(--text-3)' }}>
                      +{f.added} −{f.removed}
                    </span>
                  </button>
                  {expanded && patch && (
                    <pre
                      className="mono m-0 overflow-x-auto px-[24px] pb-[14px] t-code"
                      style={{ color: 'var(--text-2)' }}
                    >
                      {patch.length > 20_000 ? `${patch.slice(0, 20_000)}\n… truncated` : patch}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
