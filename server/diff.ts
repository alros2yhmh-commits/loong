/* ---------------------------------------------------------------------------
   A small, dependency-free line diff.

   Approval without a diff is not approval, it is a click. This produces a
   unified diff for the common case (a file under a few thousand lines) and
   degrades to a size summary for anything larger, so the approval card can
   always show something true.
   --------------------------------------------------------------------------- */

type Op = { t: ' ' | '-' | '+'; line: string }

const MAX_LINES = 1500

function ops(before: string[], after: string[]): Op[] {
  const n = before.length
  const m = after.length
  /* LCS table, computed from the end so the walk can go forward */
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ t: ' ', line: before[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: '-', line: before[i] })
      i++
    } else {
      out.push({ t: '+', line: after[j] })
      j++
    }
  }
  while (i < n) out.push({ t: '-', line: before[i++] })
  while (j < m) out.push({ t: '+', line: after[j++] })
  return out
}

/** a unified diff with context lines, or a size summary when it is too large */
export function unifiedDiff(before: string, after: string, context = 3): string {
  /* split on any newline shape: a CRLF file rewritten with LF endings would
     otherwise show every single line as changed, which is a diff that lies */
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return `(${a.length} lines → ${b.length} lines; too large to show inline)`
  }

  const all = ops(a, b)
  const changed = all
    .map((o, idx) => (o.t === ' ' ? -1 : idx))
    .filter((idx) => idx >= 0)
  if (changed.length === 0) return '(no textual change)'

  /* merge changes whose context windows overlap into one hunk */
  const hunks: { start: number; end: number }[] = []
  for (const idx of changed) {
    const start = Math.max(0, idx - context)
    const end = Math.min(all.length, idx + context + 1)
    const last = hunks[hunks.length - 1]
    if (last && start <= last.end) last.end = Math.max(last.end, end)
    else hunks.push({ start, end })
  }

  const lines: string[] = []
  for (const h of hunks) {
    const slice = all.slice(h.start, h.end)
    const oldCount = slice.filter((o) => o.t !== '+').length
    const newCount = slice.filter((o) => o.t !== '-').length
    lines.push(`@@ -${h.start + 1},${oldCount} +${h.start + 1},${newCount} @@`)
    for (const o of slice) lines.push(`${o.t}${o.line}`)
  }
  return lines.join('\n')
}
