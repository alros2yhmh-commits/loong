import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { dur, easeOut } from '../motion/tokens'

/* ---------------------------------------------------------------------------
   DiffView — the interactive diff.

   One file's change, the way a reviewer reads it: line numbers on both sides,
   a unified/side-by-side toggle, per-hunk controls, and a copy of the patch.
   Everything is monochrome — the engraving is the marking, exactly like the
   rest of Loong. Added lines sit at the top of the ramp, removed lines sit in
   the middle with a strike, context sits faint. No colour is spent.

   The LCS walk and the hunks are computed here, not on the server: this
   component owns what a diff looks like, and a diff that arrives pre-rendered
   is a diff nobody can improve. Small files only — a 400-line change is read
   by opening the file, not by squinting at a card.
   --------------------------------------------------------------------------- */

type Row = {
  kind: 'same' | 'add' | 'del'
  text: string
  /** line number on the before side (same/del) */
  a?: number
  /** line number on the after side (same/add) */
  b?: number
  /** which hunk this change line belongs to; undefined for context */
  hunk?: number
}

function computeRows(before: string, after: string): Row[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const raw: Omit<Row, 'hunk'>[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'same', text: a[i], a: i + 1, b: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: 'del', text: a[i], a: i + 1 })
      i++
    } else {
      raw.push({ kind: 'add', text: b[j], b: j + 1 })
      j++
    }
  }
  while (i < n) {
    raw.push({ kind: 'del', text: a[i], a: i + 1 })
    i++
  }
  while (j < m) {
    raw.push({ kind: 'add', text: b[j], b: j + 1 })
    j++
  }
  /* number the hunks: a hunk is a maximal run of change lines, split by any
     run of context. Reviewers think in hunks — "that change", "this change" */
  const rows: Row[] = []
  let hunk = -1
  let prevChange = false
  for (const r of raw) {
    const change = r.kind !== 'same'
    if (change && !prevChange) hunk++
    rows.push({ ...r, hunk: change ? hunk : undefined })
    prevChange = change
  }
  return rows
}

function hunkStats(rows: Row[], id: number) {
  let add = 0
  let del = 0
  for (const r of rows) {
    if (r.hunk === id) {
      if (r.kind === 'add') add++
      else if (r.kind === 'del') del++
    }
  }
  return { add, del }
}

function toPatch(before: string, after: string): string {
  const rows = computeRows(before, after)
  return rows
    .map((r) => `${r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}${r.text}`)
    .join('\n')
}

interface DiffViewProps {
  before: string | null
  after: string
  /** shown in the header; defaults to nothing */
  filename?: string
  /** per-hunk review controls. Off where the change has no per-line decision. */
  review?: boolean
  /** hunk indices the reader has reverted — a review aid, not an apply step */
  reverted?: number[]
  onRevert?: (reverted: number[]) => void
  /** how many context lines to show before clamping; the whole thing expands */
  clamp?: number
}

export function DiffView({
  before,
  after,
  filename,
  review = false,
  reverted,
  onRevert,
  clamp = 80,
}: DiffViewProps) {
  const reduced = useReducedMotion()
  const [split, setSplit] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localReverted, setLocalReverted] = useState<Set<number>>(new Set())

  const rows = useMemo(() => computeRows(before ?? '', after), [before, after])
  const added = rows.filter((r) => r.kind === 'add').length
  const removed = rows.filter((r) => r.kind === 'del').length
  const hunkCount = rows.reduce((mx, r) => (r.hunk ?? -1) + 1 > mx ? (r.hunk ?? -1) + 1 : mx, 0)

  const revertedSet = useMemo(
    () => new Set(reverted ?? localReverted),
    [reverted, localReverted],
  )

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(t)
  }, [copied])

  const toggleHunk = (id: number) => {
    const next = new Set(revertedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (onRevert) onRevert([...next].sort((x, y) => x - y))
    else setLocalReverted(next)
  }

  /* the new-file case: everything is an addition, no before to walk */
  const visible = expanded ? rows : rows.slice(0, clamp)
  const clamped = !expanded && rows.length > clamp

  const cellColor = (kind: Row['kind'], dim: boolean) => {
    const base =
      kind === 'add' ? 'var(--text-1)' : kind === 'del' ? 'var(--text-3)' : 'var(--text-3)'
    return dim ? 'var(--text-4)' : base
  }

  const copy = () => {
    void navigator.clipboard
      ?.writeText(toPatch(before ?? '', after))
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  let lastHunk: number | undefined
  let hunkSeen = 0

  return (
    <div
      className="overflow-hidden rounded-[7px]"
      style={{ border: '1px solid var(--line-2)', background: 'var(--surface-sunken)' }}
    >
      {/* header: what, how big, and the two ways to look at it */}
      <div className="flex items-center gap-[8px] px-[10px] py-[6px]"
        style={{ borderBottom: '1px solid var(--line-2)' }}>
        <span className="mono min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--text-1)' }}>
          {before === null ? '+ ' : ''}
          {filename ?? 'changes'}
        </span>
        <span className="mono shrink-0 text-[10.5px]" style={{ color: 'var(--text-4)' }}>
          +{added} −{removed}
          {hunkCount > 0 && ` · ${hunkCount} h${hunkCount === 1 ? '' : 'unks'}`}
        </span>
        <button
          type="button"
          className="ctl rounded-[4px] px-[6px] py-[1px] text-[10.5px]"
          style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
          onClick={() => setSplit((v) => !v)}
          title="Toggle side-by-side"
        >
          {split ? 'unified' : 'split'}
        </button>
        <button
          type="button"
          className="ctl rounded-[4px] px-[6px] py-[1px] text-[10.5px]"
          style={{ border: '1px solid var(--line-2)', color: copied ? 'var(--text-1)' : 'var(--text-3)' }}
          onClick={copy}
          title="Copy as a patch"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      <div
        className="mono overflow-auto px-[10px] pb-[8px] text-[11px] leading-[1.6]"
        style={{ maxHeight: expanded ? 460 : 240 }}
      >
        {split ? (
          <table className="w-full border-collapse" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <colgroup><col style={{ width: '50%' }} /><col style={{ width: '50%' }} /></colgroup>
            <tbody>
              {visible.map((r, idx) => {
                const dim = r.hunk != null && revertedSet.has(r.hunk)
                const hunkStart = r.hunk != null && r.hunk !== lastHunk
                lastHunk = r.hunk
                if (hunkStart) hunkSeen++
                const showHunkHead = hunkStart && review
                if (showHunkHead) {
                  const st = hunkStats(rows, r.hunk!)
                  return [
                    <tr key={`h${idx}`}>
                      <td colSpan={2} className="pb-[3px]">
                        <HunkHead
                          index={hunkSeen}
                          add={st.add}
                          del={st.del}
                          reverted={dim}
                          onToggle={() => toggleHunk(r.hunk!)}
                          reduced={!!reduced}
                        />
                      </td>
                    </tr>,
                    <tr key={idx}>
                      {r.kind === 'add' ? (
                        <>
                          <td />
                          <SplitCell text={r.text} num={r.b} kind="add" dim={dim} color={cellColor('add', dim)} />
                        </>
                      ) : r.kind === 'del' ? (
                        <>
                          <SplitCell text={r.text} num={r.a} kind="del" dim={dim} color={cellColor('del', dim)} />
                          <td />
                        </>
                      ) : (
                        <>
                          <SplitCell text={r.text} num={r.a} kind="same" dim={dim} color={cellColor('same', dim)} />
                          <SplitCell text={r.text} num={r.b} kind="same" dim={dim} color={cellColor('same', dim)} />
                        </>
                      )}
                    </tr>,
                  ]
                }
                return (
                  <tr key={idx}>
                    {r.kind === 'add' ? (
                      <>
                        <td />
                        <SplitCell text={r.text} num={r.b} kind="add" dim={dim} color={cellColor('add', dim)} />
                      </>
                    ) : r.kind === 'del' ? (
                      <>
                        <SplitCell text={r.text} num={r.a} kind="del" dim={dim} color={cellColor('del', dim)} />
                        <td />
                      </>
                    ) : (
                      <>
                        <SplitCell text={r.text} num={r.a} kind="same" dim={dim} color={cellColor('same', dim)} />
                        <SplitCell text={r.text} num={r.b} kind="same" dim={dim} color={cellColor('same', dim)} />
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          visible.map((r, idx) => {
            const dim = r.hunk != null && revertedSet.has(r.hunk)
            const hunkStart = r.hunk != null && r.hunk !== lastHunk
            lastHunk = r.hunk
            if (hunkStart) hunkSeen++
            return (
              <div key={idx}>
                {hunkStart && review && (
                  <HunkHead
                    index={hunkSeen}
                    add={hunkStats(rows, r.hunk!).add}
                    del={hunkStats(rows, r.hunk!).del}
                    reverted={dim}
                    onToggle={() => toggleHunk(r.hunk!)}
                    reduced={!!reduced}
                  />
                )}
                <div className="flex gap-[8px] whitespace-pre-wrap break-all">
                  <span className="w-[26px] shrink-0 text-right" style={{ color: 'var(--text-4)', opacity: 0.55 }}>
                    {r.a ?? ''}
                  </span>
                  <span className="w-[26px] shrink-0 text-right" style={{ color: 'var(--text-4)', opacity: 0.55 }}>
                    {r.b ?? ''}
                  </span>
                  <span className="shrink-0" style={{ color: cellColor(r.kind, dim) }}>
                    {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '}
                  </span>
                  <span
                    style={{
                      color: cellColor(r.kind, dim),
                      textDecoration: r.kind === 'del' || dim ? 'line-through' : undefined,
                      textDecorationColor: 'var(--line-3)',
                    }}
                  >
                    {r.text || ' '}
                  </span>
                </div>
              </div>
            )
          })
        )}

        {clamped && (
          <button
            type="button"
            className="ctl mt-[6px] rounded-[4px] px-[6px] py-[1px] text-[10.5px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={() => setExpanded(true)}
          >
            show all {rows.length} lines
          </button>
        )}
        {expanded && clamped && (
          <button
            type="button"
            className="ctl mt-[6px] ml-[6px] rounded-[4px] px-[6px] py-[1px] text-[10.5px]"
            style={{ border: '1px solid var(--line-2)', color: 'var(--text-3)' }}
            onClick={() => setExpanded(false)}
          >
            collapse
          </button>
        )}
      </div>
    </div>
  )
}

function SplitCell({
  text,
  num,
  kind,
  dim,
  color,
}: {
  text: string
  num?: number
  kind: Row['kind']
  dim: boolean
  color: string
}) {
  return (
    <td className="align-top">
      <div className="flex gap-[6px] whitespace-pre-wrap break-all px-[2px]">
        <span className="w-[24px] shrink-0 text-right" style={{ color: 'var(--text-4)', opacity: 0.5 }}>
          {num ?? ''}
        </span>
        <span className="shrink-0" style={{ color }}>
          {kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}
        </span>
        <span
          style={{
            color,
            textDecoration: kind === 'del' || dim ? 'line-through' : undefined,
            textDecorationColor: 'var(--line-3)',
          }}
        >
          {text || ' '}
        </span>
      </div>
    </td>
  )
}

function HunkHead({
  index,
  add,
  del,
  reverted,
  onToggle,
  reduced,
}: {
  index: number
  add: number
  del: number
  reverted: boolean
  onToggle: () => void
  reduced: boolean
}) {
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.enter, ease: easeOut }}
      className="my-[4px] flex items-center gap-[7px] rounded-[4px] px-[6px] py-[3px]"
      style={{ border: '1px solid var(--line-2)', background: 'var(--canvas)' }}
    >
      <span className="mono text-[10px]" style={{ color: 'var(--text-4)' }}>
        hunk {index}
      </span>
      <span className="mono text-[10px]" style={{ color: 'var(--text-4)' }}>
        +{add} −{del}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className="ctl rounded-[4px] px-[7px] py-[1px] text-[10px]"
        style={{
          border: '1px solid var(--line-3)',
          color: reverted ? 'var(--text-1)' : 'var(--text-4)',
        }}
        onClick={onToggle}
        title={reverted ? 'Keep this change' : 'Mark this change to revisit (review aid)'}
      >
        {reverted ? 'reverted · keep' : 'mark'}
      </button>
    </motion.div>
  )
}
